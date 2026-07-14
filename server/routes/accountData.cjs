const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  accountDataPlatformCollectEnabled,
  chromeProfileDirectoryMap,
  dashboardProfileMeta,
  dataMaintenanceProfile,
  publishAccountCatalog,
  publishVolumeExcluded
} = require('../lib/accountCatalog.cjs');

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
  const dashboardSnapshotFile = path.join(root, 'data', 'account-data-dashboard-snapshot.json');
  const historyDbFile = path.join(root, 'data', 'account_data_history.db');
  const scheduleDbFile = path.join(root, 'data', 'schedule.db');
  const profitDbFile = path.join(root, 'data', 'profit.db');
  const collectScript = path.join(repoRoot, 'scripts', 'collect-platform-data.cjs');
  const collectBatchScript = path.join(repoRoot, 'scripts', 'collect-account-data-batch.cjs');
  const openCliMain = process.env.OPENCLI_MAIN ||
    path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
  const openCliExtensionDir = process.env.OPENCLI_EXTENSION_DIR
    || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');
  const scheduledHours = parseScheduledHours(process.env.ACCOUNT_DATA_SCHEDULE_HOURS) || [8, 16];
  let collectProcess = null;
  let collectScheduler = null;
  let lastScheduleSlot = '';
  let collectIndexCache = null;
  let activeLoginWindow = null;
  let businessContextCache = null;
  let dashboardCache = null;
  let dashboardRefreshPromise = null;
  let dashboardMaterializedCache = null;
  const DASHBOARD_PREWARM_DELAY_MS = Number(process.env.ACCOUNT_DATA_DASHBOARD_PREWARM_DELAY_MS || 2500);

  const profileMeta = dashboardProfileMeta();
  const allowedProfiles = new Set(Object.keys(profileMeta));
  const chromeProfiles = chromeProfileDirectoryMap();

  const platformLabels = {
    douyin: '\u6296\u97f3',
    kuaishou: '\u5feb\u624b',
    bilibili: 'B\u7ad9',
    xiaohongshu: '\u5c0f\u7ea2\u4e66',
    wechatVideo: '\u89c6\u9891\u53f7',
  };
  const dashboardPlaceholderPlatforms = new Set(['douyin', 'bilibili']);
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

  function fileSignature(file) {
    try {
      const stat = fs.statSync(file);
      return [Math.round(stat.mtimeMs || 0), stat.size || 0].join(':');
    } catch (e) {
      return '0:0';
    }
  }

  function tailText(value, limit) {
    const text = String(value || '');
    return text.length > limit ? text.slice(text.length - limit) : text;
  }

  function splitArg(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  }

  function mergeNodeOptions(current, addition) {
    const parts = String(current || '').split(/\s+/).filter(Boolean);
    for (const part of String(addition || '').split(/\s+/).filter(Boolean)) {
      if (!parts.includes(part)) parts.push(part);
    }
    return parts.join(' ');
  }

  function parseScheduledHours(value) {
    const hours = splitArg(value)
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item >= 0 && item <= 23);
    return hours.length ? Array.from(new Set(hours)).sort((a, b) => a - b) : null;
  }

  function chromeBin() {
    const candidates = [
      process.env.CHROME_BIN,
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
    return candidates.find(item => fs.existsSync(item)) || candidates[0] || 'chrome.exe';
  }

  function chromeUserDataDir() {
    return process.env.CHROME_USER_DATA_DIR
      || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  }

  function accountDataLoginUrl(platformId) {
    if (platformId === 'douyin') return 'https://creator.douyin.com/creator-micro/data-center/content';
    if (platformId === 'kuaishou') return 'https://cp.kuaishou.com/statistics/article';
    if (platformId === 'bilibili') return 'https://member.bilibili.com/platform/data-up/video?tab=audience';
    if (platformId === 'xiaohongshu') return 'https://creator.xiaohongshu.com/publish/publish';
    if (platformId === 'wechatVideo') return 'https://channels.weixin.qq.com/platform/post/create';
    return '';
  }

  function runCommand(command, argv, options = {}) {
    return new Promise(resolve => {
      const started = Date.now();
      let stdout = '';
      let stderr = '';
      let finished = false;
      let child = null;
      try {
        child = spawn(command, argv, {
          cwd: options.cwd || repoRoot,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: Object.assign({}, process.env, options.env || {})
        });
      } catch (err) {
        resolve({ code: -1, stdout, stderr: err.message || String(err), durationMs: Date.now() - started });
        return;
      }
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { child.kill(); } catch (e) {}
        resolve({ code: -1, stdout, stderr: stderr + '\nTIMEOUT', durationMs: Date.now() - started });
      }, options.timeoutMs || 60000);
      child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.on('error', err => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: stderr + '\n' + (err.message || String(err)), durationMs: Date.now() - started });
      });
      child.on('close', code => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ code: code == null ? 1 : code, stdout, stderr, durationMs: Date.now() - started });
      });
    });
  }

  function runOpenCli(args, options = {}) {
    if (!fs.existsSync(openCliMain)) {
      return Promise.resolve({ code: -1, stdout: '', stderr: 'opencli main not found: ' + openCliMain, durationMs: 0 });
    }
    return runCommand(process.execPath, [openCliMain].concat(args), Object.assign({ timeoutMs: 60000 }, options));
  }

  async function closeChromeProfileDirectory(profileDirectory, reason) {
    if (!profileDirectory) return { ok: true, skipped: true, reason: reason || 'missing profile directory' };
    const escaped = String(profileDirectory).replace(/'/g, "''");
    const script = [
      "$needle='--profile-directory=" + escaped + "';",
      "$needleQuoted='--profile-directory=\"" + escaped + "\"';",
      "$killed=@();",
      "for($i=0;$i -lt 3;$i++){",
      "$rows=Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $cmd=($_.CommandLine -replace '\"',''); $cmd -like \"*$needle*\" -or $_.CommandLine -like \"*$needleQuoted*\" };",
      "if(-not $rows){ break }",
      "$rows | ForEach-Object { $killed += $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };",
      "Start-Sleep -Milliseconds 800;",
      "}",
      "$killed | Select-Object -Unique"
    ].join(' ');
    const result = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 30000 });
    return {
      ok: result.code === 0,
      code: result.code,
      profileDirectory,
      reason: reason || '',
      killedPids: String(result.stdout || '').trim().split(/\s+/).filter(Boolean),
      stderr: String(result.stderr || '').trim()
    };
  }

  function loginProbeScript(platform) {
    const checks = {
      douyin: {
        goodUrl: 'creator.douyin.com',
        badUrl: 'passport|login',
        goodText: '创作者|数据中心|作品|发布|内容管理',
        badText: '扫码登录|手机号登录|密码登录|请登录|登录后'
      },
      kuaishou: {
        goodUrl: 'cp.kuaishou.com',
        badUrl: 'passport|login',
        goodText: '作品分析|数据概览|粉丝分析|内容管理|互动管理|发布作品',
        badText: '立即登录|扫码登录|验证码登录|密码登录|请登录'
      },
      bilibili: {
        goodUrl: 'member.bilibili.com',
        badUrl: 'passport.bilibili.com|login',
        goodText: '创作中心|数据中心|投稿|作品|粉丝',
        badText: '扫码登录|密码登录|短信登录|请登录'
      }
    };
    const rule = checks[platform] || {
      goodUrl: '',
      badUrl: 'passport|login',
      goodText: '',
      badText: '扫码登录|密码登录|请登录'
    };
    return `(() => {
      const href = String(location.href || '');
      const text = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ');
      const badUrl = new RegExp(${JSON.stringify(rule.badUrl)}, 'i').test(href);
      const badText = new RegExp(${JSON.stringify(rule.badText)}).test(text);
      const goodUrl = ${JSON.stringify(rule.goodUrl)} ? href.includes(${JSON.stringify(rule.goodUrl)}) : true;
      const goodText = ${JSON.stringify(rule.goodText)} ? new RegExp(${JSON.stringify(rule.goodText)}).test(text) : true;
      return { loggedIn: Boolean(goodUrl && goodText && !badUrl && !badText), href, title: document.title || '', text: text.slice(0, 300) };
    })()`;
  }

  async function finishLoginWindow(reason) {
    const current = activeLoginWindow;
    if (!current) return { ok: true, skipped: true, reason: reason || 'no active login window' };
    activeLoginWindow = null;
    clearTimeout(current.timeoutTimer);
    clearInterval(current.pollTimer);
    const sessionClose = current.session
      ? await runOpenCli(['--profile', current.profile, 'browser', current.session, 'close'], { timeoutMs: 20000 }).catch(err => ({ code: 1, stderr: err.message || String(err) }))
      : null;
    const profileClose = current.launchedByServer
      ? await closeChromeProfileDirectory(current.profileDirectory, reason || 'login window closed')
      : { ok: true, skipped: true, reason: 'profile was not launched by login manager' };
    return {
      ok: true,
      id: current.id,
      profile: current.profile,
      platform: current.platform,
      reason: reason || '',
      sessionClose,
      profileClose
    };
  }

  function activeLoginSummary() {
    if (!activeLoginWindow) return null;
    return {
      id: activeLoginWindow.id,
      profile: activeLoginWindow.profile,
      platform: activeLoginWindow.platform,
      profileDirectory: activeLoginWindow.profileDirectory,
      startedAt: activeLoginWindow.startedAt,
      expiresAt: activeLoginWindow.expiresAt
    };
  }

  function startLoginLifecycle(entry, ttlMs) {
    activeLoginWindow = entry;
    entry.timeoutTimer = setTimeout(() => {
      finishLoginWindow('login timeout').catch(() => null);
    }, ttlMs);
    entry.pollTimer = setInterval(async () => {
      const current = activeLoginWindow;
      if (!current || current.id !== entry.id || !current.connected) return;
      const probe = await runOpenCli(['--profile', current.profile, 'browser', current.session, 'eval', loginProbeScript(current.platform)], { timeoutMs: 20000 }).catch(() => null);
      const text = [probe && probe.stdout, probe && probe.stderr].filter(Boolean).join('\n');
      if (probe && probe.code === 0 && /loggedIn['"]?\s*:\s*true/i.test(text)) {
        await finishLoginWindow('login succeeded');
      }
    }, 5000);
  }

  function launchChromeProfileForLogin(profile, platformId) {
    const profileDirectory = chromeProfiles[String(profile || '').trim()];
    const url = accountDataLoginUrl(platformId);
    if (!profileDirectory) return { ok: false, error: '没有找到 Chrome Profile 映射', profileDirectory: '' };
    const launchArgs = [
      '--new-window',
      `--user-data-dir=${chromeUserDataDir()}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--profile-directory=${profileDirectory}`
    ];
    if (fs.existsSync(path.join(openCliExtensionDir, 'manifest.json'))) {
      launchArgs.push(`--load-extension=${openCliExtensionDir}`);
    }
    launchArgs.push(url || 'about:blank');
    const child = spawn(chromeBin(), launchArgs, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, profileDirectory, url };
  }

  async function openProfileLogin(body) {
    const profile = String(body.profile || body.profileAlias || '').trim();
    const platform = String(body.platform || body.platformId || '').trim();
    if (!profile) return { ok: false, error: '缺少 profile' };
    if (!platform || !accountDataLoginUrl(platform)) return { ok: false, error: '缺少或不支持的平台' };
    if (activeLoginWindow) {
      if (Date.now() >= Number(activeLoginWindow.expiresAtMs || 0)) {
        await finishLoginWindow('stale login window');
      } else {
        return {
          ok: false,
          error: `已有账号登录窗口正在处理：${activeLoginWindow.profile} / ${platformLabels[activeLoginWindow.platform] || activeLoginWindow.platform}，请先完成或关闭后再打开新的登录。`,
          active: activeLoginSummary()
        };
      }
    }
    const profileDirectory = chromeProfiles[profile] || '';
    const url = accountDataLoginUrl(platform);
    const ttlMs = Math.max(30000, Math.min(10 * 60 * 1000, Number(body.ttlMs || process.env.ACCOUNT_DATA_LOGIN_TTL_MS || 3 * 60 * 1000)));
    const daemonStatus = await runOpenCli(['daemon', 'status'], { timeoutMs: 15000 }).catch(() => null);
    if (!daemonStatus || daemonStatus.code !== 0) {
      await runOpenCli(['daemon', 'restart'], { timeoutMs: 30000 }).catch(() => null);
    }
    const session = (`account-data-login-${platform}-${profile}`).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
    const loginEntry = {
      id: [Date.now(), Math.random().toString(36).slice(2)].join('-'),
      profile,
      platform,
      session,
      profileDirectory,
      launchedByServer: false,
      connected: false,
      startedAt: new Date().toISOString(),
      expiresAtMs: Date.now() + ttlMs,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      timeoutTimer: null,
      pollTimer: null
    };
    startLoginLifecycle(loginEntry, ttlMs);
    let launched = { ok: true, profileDirectory, url };
    let openResult = await runOpenCli(['--profile', profile, 'browser', session, 'open', url], { timeoutMs: 45000 });
    if (openResult.code !== 0) {
      launched = launchChromeProfileForLogin(profile, platform);
      if (!launched.ok) {
        await finishLoginWindow('login launch failed');
        return Object.assign({ ok: false, profile, platform }, launched);
      }
      loginEntry.launchedByServer = true;
      loginEntry.profileDirectory = launched.profileDirectory || loginEntry.profileDirectory;
      await new Promise(resolve => setTimeout(resolve, Number(body.waitMs || 5000)));
      openResult = await runOpenCli(['--profile', profile, 'browser', session, 'open', url], { timeoutMs: 90000 });
    }
    loginEntry.connected = openResult.code === 0;
    const screenshotFile = path.join(root, 'data', 'account-login-screenshots', `${session}-${Date.now()}.png`);
    let screenshot = null;
    if (openResult.code === 0) {
      await new Promise(resolve => setTimeout(resolve, Number(body.screenshotWaitMs || 2000)));
      fs.mkdirSync(path.dirname(screenshotFile), { recursive: true });
      const shotResult = await runOpenCli(['--profile', profile, 'browser', session, 'screenshot', screenshotFile], { timeoutMs: 60000 });
      if (shotResult.code === 0 && fs.existsSync(screenshotFile)) {
        screenshot = {
          file: screenshotFile,
          dataUrl: 'data:image/png;base64,' + fs.readFileSync(screenshotFile).toString('base64')
        };
      }
    }
    return {
      ok: true,
      profile,
      platform,
      url,
      profileDirectory: launched.profileDirectory || profileDirectory,
      loginWindow: activeLoginSummary(),
      screenshot,
      connected: openResult.code === 0,
      error: openResult.code === 0 ? '' : (openResult.stderr || openResult.stdout || '已打开 Chrome，但 OpenCLI 扩展暂未连接，无法截图')
    };
  }

  async function closeProfileLogin(body) {
    const id = String(body.id || body.loginWindowId || '').trim();
    if (id && activeLoginWindow && activeLoginWindow.id !== id) {
      return { ok: false, error: '当前登录窗口已经不是这个任务，未关闭新的登录窗口', active: activeLoginSummary() };
    }
    return finishLoginWindow(body.reason || 'user closed login modal');
  }

  function defaultCollectTargets(options) {
    const requestedPlatforms = splitArg(
      (options && options.platforms) || process.env.ACCOUNT_DATA_COLLECT_PLATFORMS || 'douyin,kuaishou,bilibili'
    );
    const excludedProfiles = collectExcludedProfiles(options);
    const seen = new Set();
    const targets = [];
    for (const platformId of requestedPlatforms) {
      for (const account of publishAccountCatalog()) {
        for (const platform of account.platforms || []) {
          if (platform.id !== platformId) continue;
          if (platform.runnable === false) continue;
          const alias = String(platform.profile_alias || platform.profile || '').trim();
          if (!accountDataPlatformCollectEnabled(alias, platform.id)) continue;
          if (excludedProfiles.has(alias)) continue;
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

  function collectExcludedProfiles(options) {
    return new Set(splitArg(
      (options && options.excludeProfiles)
      || process.env.ACCOUNT_DATA_COLLECT_EXCLUDE_PROFILES
      || ''
    ));
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

  function isProcessAlive(pid) {
    const numericPid = Number(pid) || 0;
    if (!numericPid) return false;
    try {
      process.kill(numericPid, 0);
      return true;
    } catch (e) {
      return false;
    }
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

  function businessContextCacheKey() {
    return [
      fileSignature(scheduleDbFile),
      fileSignature(profitDbFile)
    ].join('|');
  }

  function dashboardCacheKey(snapshot) {
    return [
      snapshot && snapshot.digest || '',
      fileSignature(scheduleDbFile),
      fileSignature(profitDbFile),
      fileSignature(collectStateFile),
      fileSignature(path.join(root, 'data', 'account-platform-status.json'))
    ].join('|');
  }

  function collectIndexIsFresh(index, snapshot) {
    return Boolean(
      index
      && index.ok
      && index.version >= 9
      && index.sourceStats
      && index.sourceStats.digest === snapshot.digest
    );
  }

  function hasHeader(row, patterns) {
    const entries = Object.entries(row || {});
    return patterns.some(pattern => entries.some(([key, value]) => (
      value !== undefined
      && value !== null
      && value !== ''
      && pattern.test(String(key || ''))
    )));
  }

  function collectWorksQuality(row) {
    const rows = readTable(row && row.file);
    const monthKey = dateKey(new Date()).slice(0, 7);
    let monthRows = 0;
    let latestDate = '';
    const titleKeys = [];
    const first = rows[0] || {};
    const hasViews = hasHeader(first, [/\u64ad\u653e\u91cf/, /^play$/i, /^views?$/i]);
    const hasLikes = hasHeader(first, [/\u70b9\u8d5e\u91cf/, /^like$/i, /^likes$/i]);
    const hasComments = hasHeader(first, [/\u8bc4\u8bba\u91cf/, /^comment$/i, /^comments$/i, /^reply$/i]);
    const hasFavorites = hasHeader(first, [/\u6536\u85cf\u91cf/, /^fav$/i, /^favorite/i, /^collect/i]);
    for (const item of rows) {
      const publishAt = String(pickByHeader(item, [/发布时间/, /^pubtime$/i, /发布日期/, /^publish/i]) || '').trim();
      const titleKey = normalizeMatchText(pickByHeader(item, [/作品名称/, /作品标题/, /^作品$/, /视频标题/, /视频名称/, /^标题$/, /^title$/i, /内容/]));
      if (titleKey) titleKeys.push(titleKey.slice(0, 80));
      const key = dateKey(publishAt);
      if (!key) continue;
      if (!latestDate || key > latestDate) latestDate = key;
      if (key.slice(0, 7) === monthKey) monthRows += 1;
    }
    return {
      rows: rows.length,
      monthRows,
      latestDate,
      hasViews,
      hasLikes,
      hasComments,
      hasFavorites,
      completeInteraction: hasLikes && hasComments && hasFavorites,
      titleKeys: Array.from(new Set(titleKeys)).slice(0, 120)
    };
  }

  function titleOverlapRatio(left, right) {
    const a = new Set(((left && left.titleKeys) || []).filter(Boolean));
    const b = new Set(((right && right.titleKeys) || []).filter(Boolean));
    if (!a.size || !b.size) return 1;
    let overlap = 0;
    for (const key of b) {
      if (a.has(key)) overlap += 1;
    }
    return overlap / Math.min(a.size, b.size);
  }

  function shouldReplaceLatestDataset(previous, next) {
    if (!previous) return true;
    if (!next || !next.ok || !next.platform || !next.dataset || !next.file) return false;
    if (next.platform === 'douyin' && next.dataset === 'works') {
      const previousComplete = Boolean(previous.quality && previous.quality.completeInteraction);
      const nextComplete = Boolean(next.quality && next.quality.completeInteraction);
      if (previousComplete && !nextComplete) return false;
      if (!previousComplete && nextComplete) return true;
    }
    return true;
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
        if (row.dataset === 'works' && row.file) row.quality = collectWorksQuality(row);
        run.datasets.push(row);
        datasetHistory.push(row);
        if (!row.ok || !row.platform || !row.dataset || !row.file) continue;
        const key = [profile, row.platform, row.dataset].join(':');
        if (shouldReplaceLatestDataset(latestDatasets[key], row)) {
          latestDatasets[key] = row;
        }
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
      version: 9,
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

  function parseVideoDurationSeconds(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '-') return 0;
    const normalized = raw
      .replace(/分钟/g, 'min')
      .replace(/分/g, 'min')
      .replace(/秒/g, 's')
      .replace(/视频/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
    const range = normalized.match(/(\d+(?:\.\d+)?)(?:-|~|–|—|至|到)(\d+(?:\.\d+)?)(min|m|s|秒)?/i);
    if (range) {
      const unit = range[3] || (normalized.includes('min') ? 'min' : 's');
      const valueSeconds = Math.max(Number(range[1]) || 0, Number(range[2]) || 0);
      return /min|m/i.test(unit) ? valueSeconds * 60 : valueSeconds;
    }
    const plus = normalized.match(/(\d+(?:\.\d+)?)(min|m|s)\+/i);
    if (plus) return /min|m/i.test(plus[2]) ? Number(plus[1]) * 60 : Number(plus[1]);
    const minuteSecond = normalized.match(/(?:(\d+(?:\.\d+)?)min)?(?:(\d+(?:\.\d+)?)s)?/i);
    if (minuteSecond && (minuteSecond[1] || minuteSecond[2])) {
      return (Number(minuteSecond[1]) || 0) * 60 + (Number(minuteSecond[2]) || 0);
    }
    return 0;
  }

  function videoLengthTypeFromDuration(seconds, text) {
    const duration = Number(seconds) || 0;
    const raw = String(text || '').trim();
    if (/1\s*-\s*2\s*(?:min|分钟|分)|20\s*-\s*60\s*s|短视频|热点|常规/i.test(raw)) return 'short';
    if (/1\s*-\s*3\s*(?:min|分钟|分)/i.test(raw)) return 'long';
    if (duration >= 120 || /(?:2\s*-\s*3|3\s*-\s*5|4)\s*(?:min|分钟|分)|4min\+|长视频|深度体验|解说向/i.test(raw)) return 'long';
    if (duration > 0) return 'short';
    return 'unknown';
  }

  function videoLengthLabel(type) {
    if (type === 'long') return '长视频';
    if (type === 'short') return '短视频';
    return '未知';
  }

  function extractVideoDuration(row) {
    const durationText = String(pickByHeader(row, [/^时长$/, /时长秒/, /视频时长/, /作品时长/, /体裁/, /视频类型/, /内容类型/, /平均播放时长/]) || '').trim();
    const seconds = parseVideoDurationSeconds(
      pickByHeader(row, [/时长秒/, /^duration$/i, /视频时长/, /作品时长/]) || durationText
    );
    const type = videoLengthTypeFromDuration(seconds, durationText);
    return {
      videoDurationText: durationText,
      videoDurationSeconds: Math.round(seconds || 0),
      videoLengthType: type,
      videoLengthLabel: videoLengthLabel(type)
    };
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
    if (/b\u7ad9|bilibili|\u54d4\u54e9|B\u7ad9/i.test(text)) return 'bilibili';
    if (/\u6296\u97f3|douyin|\u5de8\u91cf|\u661f\u56fe/i.test(text)) return 'douyin';
    if (/\u5feb\u624b|kuaishou|\u78c1\u529b\u805a\u661f|\u5feb\u63a5\u5355/i.test(text)) return 'kuaishou';
    if (/\u5c0f\u7ea2\u4e66|xiaohongshu|\u84b2\u516c\u82f1/i.test(text)) return 'xiaohongshu';
    if (/\u89c6\u9891\u53f7|wechat/i.test(text)) return 'wechatVideo';
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

  function sqliteAll(file, sql, params, attempt) {
    return new Promise(resolve => {
      if (!sqlite3 || !fs.existsSync(file)) return resolve([]);
      let settled = false;
      const currentAttempt = Number(attempt) || 0;
      function isBusy(error) {
        return /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(error && error.message || String(error || ''));
      }
      function finish(db, rows, error) {
        if (settled) return;
        settled = true;
        try { if (db) db.close(); } catch (e) {}
        if (error && isBusy(error) && currentAttempt < 3) {
          setTimeout(() => {
            sqliteAll(file, sql, params, currentAttempt + 1).then(resolve);
          }, 250 * (currentAttempt + 1));
          return;
        }
        resolve(rows || []);
      }
      const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, error => {
        if (error) return finish(null, [], error);
        try { db.configure('busyTimeout', 30000); } catch (e) {}
        db.on('error', error => finish(db, [], error));
        db.all(sql, params || [], (queryError, rows) => {
          finish(db, queryError ? [] : rows, queryError);
        });
      });
    });
  }

  function sqliteExec(file, sql) {
    return new Promise(resolve => {
      if (!sqlite3) return resolve({ ok: false, error: 'sqlite3 unavailable' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new sqlite3.Database(file, error => {
        if (error) return resolve({ ok: false, error: error.message });
        db.exec(sql, execError => {
          try { db.close(); } catch (e) {}
          resolve(execError ? { ok: false, error: execError.message } : { ok: true });
        });
      });
    });
  }

  function sqliteExecIgnoreDuplicateColumn(file, sql) {
    return sqliteExec(file, sql).then(result => {
      if (result && result.ok) return result;
      if (/duplicate column name/i.test(result && result.error || '')) return { ok: true, skipped: true };
      return result;
    });
  }

  function readProfitOrderRows(attempt) {
    return new Promise(resolve => {
      if (!sqlite3 || !fs.existsSync(profitDbFile)) return resolve([]);
      const currentAttempt = Number(attempt) || 0;
      const db = new sqlite3.Database(profitDbFile, sqlite3.OPEN_READONLY, error => {
        if (error) {
          if (/SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(error.message || '') && currentAttempt < 3) {
            setTimeout(() => readProfitOrderRows(currentAttempt + 1).then(resolve), 250 * (currentAttempt + 1));
          } else {
            resolve([]);
          }
          return;
        }
        try { db.configure('busyTimeout', 30000); } catch (e) {}
        db.all('SELECT account, platform, month, remark, business_type, category FROM profits', [], (queryError, rows) => {
          try { db.close(); } catch (e) {}
          if (queryError && /SQLITE_BUSY|database is locked|SQLITE_LOCKED/i.test(queryError.message || '') && currentAttempt < 3) {
            setTimeout(() => readProfitOrderRows(currentAttempt + 1).then(resolve), 250 * (currentAttempt + 1));
            return;
          }
          resolve(queryError ? [] : (rows || []));
        });
      });
    });
  }

  async function ensureAccountDataHistoryDb() {
    const result = await sqliteExec(historyDbFile, `
      CREATE TABLE IF NOT EXISTS account_data_works (
        key TEXT PRIMARY KEY,
        profile TEXT NOT NULL,
        canonical_profile TEXT DEFAULT '',
        account_id TEXT DEFAULT '',
        account TEXT DEFAULT '',
        group_id INTEGER DEFAULT 0,
        group_name TEXT DEFAULT '',
        owner TEXT DEFAULT '',
        platform TEXT NOT NULL,
        title TEXT DEFAULT '',
        publish_at TEXT DEFAULT '',
        publish_date TEXT DEFAULT '',
        publish_month TEXT DEFAULT '',
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        favorites INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        fan_gain INTEGER DEFAULT 0,
        completion_rate REAL DEFAULT 0,
        interaction_rate REAL DEFAULT 0,
        hot_index INTEGER DEFAULT 0,
        hidden_by_zero_views INTEGER DEFAULT 0,
        video_duration_seconds INTEGER DEFAULT 0,
        video_duration_text TEXT DEFAULT '',
        video_length_type TEXT DEFAULT '',
        content_type TEXT DEFAULT '',
        business_kind TEXT DEFAULT '',
        business_source TEXT DEFAULT '',
        business_reason TEXT DEFAULT '',
        source_file TEXT DEFAULT '',
        summary_file TEXT DEFAULT '',
        collected_at TEXT DEFAULT '',
        first_seen_at TEXT DEFAULT '',
        last_seen_at TEXT DEFAULT '',
        raw_json TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_account_data_works_month ON account_data_works(publish_month);
      CREATE INDEX IF NOT EXISTS idx_account_data_works_account_month ON account_data_works(account_id, platform, publish_month);
      CREATE INDEX IF NOT EXISTS idx_account_data_works_platform_month ON account_data_works(platform, publish_month);
    `);
    await sqliteExecIgnoreDuplicateColumn(historyDbFile, 'ALTER TABLE account_data_works ADD COLUMN video_duration_seconds INTEGER DEFAULT 0');
    await sqliteExecIgnoreDuplicateColumn(historyDbFile, 'ALTER TABLE account_data_works ADD COLUMN video_duration_text TEXT DEFAULT ""');
    await sqliteExecIgnoreDuplicateColumn(historyDbFile, 'ALTER TABLE account_data_works ADD COLUMN video_length_type TEXT DEFAULT ""');
    return result;
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

  function orderCountMonthKey(value) {
    const text = String(value || '');
    const full = text.match(/(20\d{2})\s*[\u5e74./-]\s*(1[0-2]|0?[1-9])(?:\s*\u6708)?\s*$/);
    if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, '0')}`;
    return '';
  }

  function businessLikeType(value) {
    const text = String(value || '');
    return /\u5546\u5355|\u5546\u52a1|\u5e7f\u544a|\u63a8\u5e7f|\u4e00\u53e3\u4ef7|\u661f\u5e7f|\u8054\u6295|CPM|\u5408\u4f5c|\u5b9a\u5236|\u79cd\u8349|\u5e26\u8d27/i.test(text);
  }

  function onePriceOrderLike(row) {
    const typeText = [row && row.business_type, row && row.category].join(' ');
    if (/\u975e\s*\u4e00\u53e3\u4ef7|\u975e\u4e00\u53e3\u4ef7/i.test(typeText)) return false;
    return /\u4e00\s*\u53e3\s*\u4ef7/i.test(typeText);
  }

  function updatePlanOrderPlatform(platform) {
    return platform === 'douyin' || platform === 'bilibili';
  }

  function cleanProjectName(value) {
    const text = String(value || '').trim();
    if (!text || text === '-' || text === '选题待定') return '';
    if (/日常|待定|无|未知/.test(text)) return '';
    return text.replace(/^(项目|产品|商单|推广|合作)\s*[：:]/, '').trim();
  }

  async function buildBusinessMatchContext() {
    const [scheduleRows, profitRows, profitOrderRows] = await Promise.all([
      sqliteAll(scheduleDbFile, 'SELECT account, type, content, remark, date, doc_title, doc_kind FROM schedules WHERE type IS NOT NULL AND TRIM(type) <> ""', []),
      sqliteAll(profitDbFile, 'SELECT account, project, platform, month, remark, business_type, category, entry_source, publish_date, lock_date, execution_status, product_line FROM profits', []),
      readProfitOrderRows()
    ]);
    const refs = [];
    const orderCountMap = new Map();
    for (const row of profitOrderRows) {
      const account = String(row.account || '').trim();
      const platform = platformIdFromLabel([row.platform, row.remark].join(' '));
      const orderMonth = orderCountMonthKey(row.month);
      const accountKey = normalizeMatchText(account);
      if (!orderMonth || !accountKey || !updatePlanOrderPlatform(platform) || !onePriceOrderLike(row)) continue;
      const countKey = [orderMonth, platform || '', accountKey].join('|');
      const current = orderCountMap.get(countKey) || {
        month: orderMonth,
        account,
        accountKey,
        platform,
        platformLabel: platform ? (platformLabels[platform] || platform) : '',
        count: 0
      };
      current.count += 1;
      orderCountMap.set(countKey, current);
    }
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
      const account = String(row.account || '').trim();
      const platform = platformIdFromLabel([row.platform, row.remark].join(' '));
      const anchoredMonth = monthKeyFromText(row.month || row.publish_date || row.lock_date);
      const accountKey = normalizeMatchText(account);
      if (!businessLikeType([row.business_type, row.category, row.remark, row.project].join(' '))) continue;
      const project = cleanProjectName(row.project || row.product_line || row.remark);
      if (!account || !project) continue;
      refs.push({
        source: 'profit',
        account,
        accountKey,
        platform,
        project,
        projectKey: normalizeMatchText(project),
        date: scheduleDateKey(row),
        month: monthKeyFromText(row.publish_date || row.lock_date || row.month),
        reason: `命中流水：${project}${platform ? ` · ${platformLabels[platform] || platform}` : ''}`
      });
    }
    return {
      refs,
      businessOrderCounts: Array.from(orderCountMap.values()).sort((a, b) => {
        return String(b.month || '').localeCompare(String(a.month || '')) ||
          String(a.platform || '').localeCompare(String(b.platform || '')) ||
          String(a.account || '').localeCompare(String(b.account || ''));
      })
    };
  }

  async function readBusinessMatchContext() {
    const key = businessContextCacheKey();
    if (
      businessContextCache
      && businessContextCache.key === key
    ) {
      return businessContextCache.value;
    }
    const value = await buildBusinessMatchContext();
    businessContextCache = { key, value, at: Date.now() };
    return value;
  }

  async function buildDashboardCacheValue(key) {
    let context = { refs: [] };
    try {
      context = await readBusinessMatchContext();
    } catch (e) {
      console.warn('[account-data] business context failed:', e && e.stack || e);
      context = { refs: [] };
    }
    const value = buildDashboard(context);
    try {
      value.historyStore = Object.assign({ enabled: true }, await persistHistoryWorks(value.works));
    } catch (error) {
      value.historyStore = { enabled: true, ok: false, error: error && error.message ? error.message : String(error || 'history store failed') };
    }
    dashboardCache = { key, value, at: Date.now() };
    const persistedSnapshot = readDashboardSnapshot(key);
    if (!persistedSnapshot || !persistedSnapshot.sourceDigest) writeDashboardSnapshot(key, value);
    return value;
  }

  function refreshDashboardCache(key) {
    if (dashboardRefreshPromise && dashboardRefreshPromise.key === key) {
      return dashboardRefreshPromise.promise;
    }
    const promise = buildDashboardCacheValue(key)
      .finally(() => {
        if (dashboardRefreshPromise && dashboardRefreshPromise.promise === promise) {
          dashboardRefreshPromise = null;
        }
      });
    dashboardRefreshPromise = { key, promise };
    return promise;
  }

  async function readDashboard(options = {}) {
    const snapshot = collectSourceSnapshot();
    const key = dashboardCacheKey(snapshot);
    const forceRefresh = Boolean(options.forceRefresh);
    if (!forceRefresh && dashboardCache && dashboardCache.key === key) {
      return dashboardCache.value;
    }
    if (!forceRefresh) {
      const materialized = readDashboardSnapshot(key);
      if (materialized && materialized.dashboard) {
        dashboardCache = { key, value: materialized.dashboard, at: Number(materialized.generatedAtMs) || Date.now() };
        return dashboardCache.value;
      }
    }
    return refreshDashboardCache(key);
  }

  function prewarmDashboardCache() {
    if (!XLSX) return;
    try {
      const key = dashboardCacheKey(collectSourceSnapshot());
      refreshDashboardCache(key).catch(error => {
        console.warn('[account-data] dashboard prewarm failed', error && error.stack || error);
      });
    } catch (error) {
      console.warn('[account-data] dashboard prewarm failed', error && error.stack || error);
    }
  }

  const dashboardPrewarmTimer = setTimeout(prewarmDashboardCache, Math.max(0, DASHBOARD_PREWARM_DELAY_MS));
  if (dashboardPrewarmTimer && typeof dashboardPrewarmTimer.unref === 'function') dashboardPrewarmTimer.unref();

  function compactDashboardPayload(result, workScope) {
    if (!result) return result;
    var collectionIndex = result.collectionIndex || {};
    var works = Array.isArray(result.works) ? result.works : [];
    if (workScope !== 'all' && !result.historyMode) {
      var now = new Date();
      var firstOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var earliestMonth = dateKey(firstOfPreviousMonth).slice(0, 7);
      works = works.filter(function(work) {
        var publishMonth = String(work && (work.publishDate || dateKey(work.publishAt)) || '').slice(0, 7);
        return publishMonth && publishMonth >= earliestMonth;
      });
    }
    // The dashboard only reads the source digest to detect a new collection.
    // The full index contains raw collection rows and can exceed 20 MB, while
    // post details for the publish-count modal stay in `works` unchanged.
    works = works.map(function(work) {
      const compactWork = Object.assign({}, work);
      delete compactWork.sourceFile;
      delete compactWork.summaryFile;
      return compactWork;
    });
    return Object.assign({}, result, {
      works: works,
      collectionIndex: {
        ok: Boolean(collectionIndex.ok),
        generatedAt: collectionIndex.generatedAt || '',
        sourceStats: collectionIndex.sourceStats || {}
      }
    });
  }

  function compactPublishWorks(works) {
    return (Array.isArray(works) ? works : []).map(function(work) {
      const summaryWork = {
        account: work.account,
        accountId: work.accountId,
        platform: work.platform,
        title: work.title,
        publishAt: work.publishAt,
        views: work.views
      };
      if (work.publishVolumeExcluded) summaryWork.publishVolumeExcluded = true;
      return summaryWork;
    });
  }

  function publishAccountKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function publishTitleKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/#[^\s#]+/g, '')
      .replace(/[\s\u00a0.,!?，。！？、:：;；'"“”‘’()（）\[\]【】\-_]+/g, '')
      .slice(0, 64);
  }

  function buildPublishStats(payload) {
    const accounts = Array.isArray(payload && payload.accounts) ? payload.accounts : [];
    const works = Array.isArray(payload && payload.works) ? payload.works : [];
    const mainPlatformByAccount = new Map();
    const platformPriority = { douyin: 3, bilibili: 2, kuaishou: 1 };
    accounts.forEach(function(account) {
      if (account && account.publishVolumeExcluded) return;
      const key = publishAccountKey(account && (account.account || account.profile || account.accountId));
      if (!key) return;
      const explicit = String(account && account.primaryPlatform || '').trim();
      if (explicit) {
        mainPlatformByAccount.set(key, { platform: explicit, score: Number.POSITIVE_INFINITY });
        return;
      }
      const platform = String(account && account.platform || '').trim();
      const score = (Number(account && account.postTotal) || 0) + (Number(account && account.hiddenTotal) || 0);
      const current = mainPlatformByAccount.get(key);
      if (!current || score > current.score || (score === current.score && (platformPriority[platform] || 0) > (platformPriority[current.platform] || 0))) {
        mainPlatformByAccount.set(key, { platform, score });
      }
    });
    const deduped = new Map();
    works.forEach(function(work, index) {
      if (!work || work.publishVolumeExcluded) return;
      const date = String(work.publishDate || dateKey(work.publishAt) || '').slice(0, 10);
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return;
      const accountKey = publishAccountKey(work.account || work.profile || work.accountId);
      const platform = String(work.platform || '').trim();
      const titleKey = publishTitleKey(work.title) || String(work.id || index);
      const key = [accountKey, platform, titleKey, date].join('|');
      const current = deduped.get(key);
      if (!current || (Number(work.views) || 0) > (Number(current.views) || 0)) deduped.set(key, work);
    });
    function aggregate(rows, includePlatform) {
      const map = new Map();
      rows.forEach(function(work) {
        const date = String(work.publishDate || dateKey(work.publishAt) || '').slice(0, 10);
        const accountId = String(work.accountId || '').trim();
        const platform = includePlatform ? String(work.platform || '').trim() : '';
        const key = [date, accountId, platform].join('|');
        const current = map.get(key) || { date, accountId, platform, count: 0 };
        current.count += 1;
        map.set(key, current);
      });
      return Array.from(map.values());
    }
    const rawWorks = Array.from(deduped.values());
    const displayWorks = rawWorks.filter(function(work) {
      const accountKey = publishAccountKey(work.account || work.profile || work.accountId);
      const main = mainPlatformByAccount.get(accountKey);
      return !main || String(work.platform || '').trim() === main.platform || (Number(work.views) || 0) >= 100000;
    });
    return {
      generatedAt: new Date().toISOString(),
      records: aggregate(rawWorks, true),
      displayRecords: aggregate(displayWorks, false)
    };
  }

  function materializedScope(payload) {
    const works = Array.isArray(payload && payload.works) ? payload.works : [];
    return {
      summary: Object.assign({}, payload, {
        works: [],
        worksTotal: works.length,
        worksDeferred: works.length > 0,
        publishStats: buildPublishStats(payload)
      }),
      publishWorks: compactPublishWorks(works)
    };
  }

  function writeDashboardSnapshot(key, dashboard) {
    try {
      const compactAll = compactDashboardPayload(dashboard, 'all');
      const compactMonth = compactDashboardPayload(dashboard, 'month');
      const snapshot = {
        version: 2,
        key,
        sourceDigest: collectSourceSnapshot().digest,
        generatedAt: new Date().toISOString(),
        generatedAtMs: Date.now(),
        dashboard: compactAll,
        scopes: {
          month: materializedScope(compactMonth),
          all: materializedScope(compactAll)
        }
      };
      safeWriteJson(dashboardSnapshotFile, snapshot);
      dashboardMaterializedCache = snapshot;
    } catch (error) {
      console.warn('[account-data] dashboard snapshot write failed', error && error.stack || error);
    }
  }

  function readDashboardSnapshot(key) {
    if (dashboardMaterializedCache) {
      if (dashboardMaterializedCache.key === key) return dashboardMaterializedCache;
      if (dashboardMaterializedCache.sourceDigest === collectSourceSnapshot().digest) return dashboardMaterializedCache;
    }
    const snapshot = safeReadJson(dashboardSnapshotFile);
    if (!snapshot || snapshot.version !== 2 || !snapshot.dashboard) return null;
    if (snapshot.key !== key) {
      const sourceDigest = collectSourceSnapshot().digest;
      if (!snapshot.sourceDigest || snapshot.sourceDigest !== sourceDigest) return null;
    }
    dashboardMaterializedCache = snapshot;
    return snapshot;
  }

  function currentDashboardSnapshot() {
    try {
      return readDashboardSnapshot(dashboardCacheKey(collectSourceSnapshot()));
    } catch (error) {
      return null;
    }
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
    ].filter(Boolean).join('；');
  }

  function buildMetricsByRange(workRows, fanRows, latestFollowers, now) {
    const metrics = {};
    rangeKeys.forEach(range => {
      const postRows = workRows.filter(row => !publishVolumeExcluded(row.profile, row.platform));
      const visiblePostRows = postRows.filter(row => !row.hiddenByZeroViews);
      const hiddenPostRows = postRows.filter(row => row.hiddenByZeroViews);
      const posts = countRows(visiblePostRows, range, 'publishDate', now);
      const hiddenPosts = countRows(hiddenPostRows, range, 'publishDate', now);
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
        hiddenPosts,
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
    const launchedDirectory = String(summary.profileState && summary.profileState.launched && summary.profileState.launched.profileDirectory || '').trim();
    if (requested && launchedDirectory) {
      const requestedDirectory = String(chromeProfiles[requested] || '').trim();
      if (requestedDirectory && requestedDirectory === launchedDirectory) return false;
    }
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

  function shortDatasetLabel(dataset) {
    const key = String(dataset || '').trim();
    if (key === 'profile') return '浏览器 Profile';
    if (key === 'works') return '作品数据';
    if (key === 'fans') return '粉丝数据';
    return key || '数据';
  }

  function compactErrorText(error) {
    return String(error || '')
      .replace(/\r/g, '\n')
      .replace(/#\s*[- ]*Native stack trace[- ]*[\s\S]*/i, '')
      .replace(/\n\s*\d+:\s+[0-9A-F]{8,}[\s\S]*/i, '')
      .replace(/\{\s*"error"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collectFailureMessage(error, dataset) {
    const raw = String(error || '').trim();
    const text = compactErrorText(raw);
    const label = shortDatasetLabel(dataset);
    if (/Fatal process out of memory|out of memory|JavaScript heap|Zone/i.test(raw)) return '浏览器采集进程内存不足，已中断；关闭多余浏览器窗口后再重试';
    if (/Browser connection dropped|Target closed|browser has been closed|WebSocket.*closed|Session closed|Page crashed|command_result_unknown|chrome-error:\/\/|RESULT_CODE_KILLED|页面崩溃|标签页已崩溃/i.test(raw)) return '浏览器连接中断或页面崩溃，稍后重试';
    if (/not connected|profile not connected|Browser profile/i.test(raw)) return '浏览器 Profile 未连接，需要重新绑定或启动浏览器扩展';
    if (/login|unauthorized|forbidden|cookie|\u672a\u767b\u5f55|\u767b\u5f55|401|403/i.test(raw)) return '登录态失效或权限不足，需要复查平台登录';
    if (/timeout|\u8d85\u65f6|ETIMEDOUT/i.test(raw)) return `${label}采集超时，需要复查平台页面或网络`;
    if (/ERR_|Failed to fetch|network|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(raw)) return '网络连接异常，采集没有完成';
    if (/opencli failed/i.test(raw)) return `${label}采集失败，opencli 执行异常`;
    return text ? text.slice(0, 120) : `${label}采集失败`;
  }

  function isLoginCollectError(error) {
    return /not connected|profile not connected|Browser profile|login|unauthorized|forbidden|cookie|\u672a\u767b\u5f55|\u767b\u5f55|401|403/i.test(String(error || ''));
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
          needsLogin: isLoginCollectError(summary.profileState.error),
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
          needsLogin: isLoginCollectError(dataset.error),
          collectedAt: summary.finishedAt || summary.startedAt || '',
          summaryFile: item.full
        });
      }
    }
    const seen = new Set();
    return failures.filter(item => item.needsLogin).filter(item => {
      const key = [item.account, item.platform, item.dataset, item.message].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 30);
  }

  function normalizedCollectState() {
    const state = readCollectState();
    const collectorPidAlive = state.collectorPid && isProcessAlive(state.collectorPid);
    if (state.running && !collectProcess && !collectorPidAlive) {
      const startedMs = Date.parse(state.startedAt || '');
      if (!Number.isFinite(startedMs) || Date.now() - startedMs > 2 * 60 * 1000) {
        return writeCollectState({
          ok: false,
          running: false,
          finishedAt: new Date().toISOString(),
          error: '采集进程已中断',
          collectorPid: 0,
          recoverable: Boolean(state.batchProgress && state.batchProgress.completed < state.batchProgress.total),
          failures: buildCollectionFailures(8)
        });
      }
    }
    return state;
  }

  function runCollectJob(options) {
    options = options || {};
    const existingState = normalizedCollectState();
    if (collectProcess || (existingState.running && existingState.collectorPid && isProcessAlive(existingState.collectorPid))) {
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
    const sessionPrefix = `account-data-${trigger}-${startedMs}`;
    const stdoutLog = path.join(exportDir, `${sessionPrefix}.stdout.log`);
    const stderrLog = path.join(exportDir, `${sessionPrefix}.stderr.log`);
    const batchSize = '1';
    const batchPauseMs = String(options.batchPauseMs || process.env.ACCOUNT_DATA_BATCH_PAUSE_MS || 2000);
    const abortAfterInfrastructureFailures = String(options.abortAfterInfrastructureFailures || process.env.ACCOUNT_DATA_ABORT_AFTER_INFRA_FAILURES || 5);
    const childNodeOptions = mergeNodeOptions(process.env.NODE_OPTIONS || '', process.env.ACCOUNT_DATA_CHILD_NODE_OPTIONS || '--max-old-space-size=4096');
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
        '--sessionPrefix', sessionPrefix
      ]
      : [
        scriptToRun,
        '--profile', profile,
        '--profileMode', 'direct',
        '--platforms', platforms,
        '--datasets', datasets,
        '--outDir', exportDir,
        '--sessionPrefix', sessionPrefix
      ];
    if (useBatch && collectTargets.length) argv.push('--targets', collectTargets.map(serializeCollectTarget).join(','));
    if (useBatch) {
      argv.push('--stateFile', collectStateFile);
      argv.push('--trigger', trigger);
      argv.push('--queueOffset', String(selection.queue && selection.queue.offset || 0));
      argv.push('--queueTotal', String(selection.queue && selection.queue.total || collectTargets.length || collectProfiles.length));
      argv.push('--queueExplicit', String(Boolean(selection.queue && selection.queue.explicit)));
    }
    if (options.launchProfile === false || options.launchProfile === 'false') argv.push('--launchProfile', 'false');
    if (closeProfile) argv.push('--closeProfile', 'true');
    argv.push('--profileConnectTimeoutMs', String(process.env.ACCOUNT_DATA_PROFILE_CONNECT_TIMEOUT_MS || 90000));
    argv.push('--browserOpenTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_OPEN_TIMEOUT_MS || 120000));
    argv.push('--browserEvalTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_EVAL_TIMEOUT_MS || 120000));
    argv.push('--browserClickTimeoutMs', String(process.env.ACCOUNT_DATA_BROWSER_CLICK_TIMEOUT_MS || 60000));
    argv.push('--pageReadyTimeoutMs', String(process.env.ACCOUNT_DATA_PAGE_READY_TIMEOUT_MS || 12000));
    argv.push('--loginProbeTimeoutMs', String(process.env.ACCOUNT_DATA_LOGIN_PROBE_TIMEOUT_MS || 6000));
    argv.push('--postOpenWaitMs', String(process.env.ACCOUNT_DATA_POST_OPEN_WAIT_MS || 1500));
    argv.push('--downloadTimeoutMs', String(process.env.ACCOUNT_DATA_DOWNLOAD_TIMEOUT_MS || 180000));
    argv.push('--skipDisconnected', String(process.env.ACCOUNT_DATA_SKIP_DISCONNECTED || 'true'));
    if (useBatch) {
      argv.push('--childTimeoutMs', String(process.env.ACCOUNT_DATA_CHILD_TIMEOUT_MS || 20 * 60 * 1000));
      argv.push('--batchSize', batchSize);
      argv.push('--batchPauseMs', batchPauseMs);
      argv.push('--abortAfterInfrastructureFailures', abortAfterInfrastructureFailures);
    }

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
      batchSize: useBatch ? Number(batchSize) || 1 : 1,
      batchPauseMs: useBatch ? Number(batchPauseMs) || 0 : 0,
      abortAfterInfrastructureFailures: useBatch ? Number(abortAfterInfrastructureFailures) || 0 : 0,
      command: [process.execPath].concat(argv),
      stdoutLog,
      stderrLog,
      error: '',
      stdoutTail: '',
      stderrTail: ''
    });

    let stdout = '';
    let stderr = '';
    fs.mkdirSync(exportDir, { recursive: true });
    try {
      fs.writeFileSync(stdoutLog, '', 'utf8');
      fs.writeFileSync(stderrLog, '', 'utf8');
    } catch (e) {}
    function appendLog(file, chunk) {
      try { fs.appendFileSync(file, chunk); } catch (e) {}
    }
    function cleanupCollectProfiles(reason) {
      const directories = collectProfiles.map(item => chromeProfiles[String(item || '').trim()]).filter(Boolean);
      Promise.all(directories.map(dir => closeChromeProfileDirectory(dir, reason))).catch(() => null);
    }
    const collectEnv = Object.assign({}, process.env, childNodeOptions ? { NODE_OPTIONS: childNodeOptions } : {});
    if (/^(schedule|scheduled|auto)$/i.test(trigger)) {
      collectEnv.ACCOUNT_DATA_CLEANUP_BETWEEN_BATCHES = 'true';
      collectEnv.ACCOUNT_DATA_PRE_CLOSE_PROFILE = 'true';
      collectEnv.ACCOUNT_DATA_FORCE_KILL_CHROME_AFTER_BATCH = process.env.ACCOUNT_DATA_FORCE_KILL_CHROME_AFTER_BATCH || '0';
    }
    collectProcess = spawn(process.execPath, argv, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: collectEnv
    });
    writeCollectState({ collectorPid: collectProcess.pid || 0 });
    collectProcess.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      stdout += text;
      appendLog(stdoutLog, text);
    });
    collectProcess.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      appendLog(stderrLog, text);
    });
    collectProcess.on('error', err => {
      collectProcess = null;
      cleanupCollectProfiles('account data collection process error');
      writeCollectState({
        ok: false,
        running: false,
        collectorPid: 0,
        finishedAt: new Date().toISOString(),
        error: err.message || String(err),
        stdoutLog,
        stderrLog,
        stdoutTail: tailText(stdout, 4000),
        stderrTail: tailText(stderr, 4000)
      });
    });
    collectProcess.on('close', code => {
      collectProcess = null;
      cleanupCollectProfiles('account data collection finished');
      const latest = latestSummaryAfter(startedMs);
      const summary = latest ? safeReadJson(latest.full) : null;
      const patch = {
        ok: code === 0 && Boolean(summary && summary.ok !== false),
        running: false,
        collectorPid: 0,
        exitCode: code,
        finishedAt: new Date().toISOString(),
        lastRun: new Date().toISOString(),
        lastSummaryFile: latest ? latest.full : '',
        profileQueue: selection.queue,
        failures: buildCollectionFailures(8),
          error: code === 0 ? '' : '采集进程退出 ' + code,
        stdoutLog,
        stderrLog,
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
      if (patch.ok) {
        dashboardCache = null;
        dashboardMaterializedCache = null;
        const nextDashboardKey = dashboardCacheKey(collectSourceSnapshot());
        refreshDashboardCache(nextDashboardKey).catch(error => {
          console.warn('[account-data] post-collection dashboard snapshot failed', error && error.stack || error);
        });
      }
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

  function historyWorkKey(work) {
    const titleKey = normalizeMatchText(work && work.title || '').slice(0, 120);
    const date = work && (work.publishDate || dateKey(work.publishAt)) || '';
    const accountKey = work && (work.accountId || work.profile || work.account) || '';
    return [accountKey, work && work.platform || '', date || 'unknown-date', titleKey || work && work.id || 'untitled'].join('|');
  }

  function normalizeHistoryWorkRow(work) {
    const publishDate = work.publishDate || dateKey(work.publishAt);
    return {
      key: historyWorkKey(work),
      profile: String(work.profile || '').trim(),
      canonical_profile: String(work.accountId || '').replace(/^.+?-/, '').trim(),
      account_id: String(work.accountId || '').trim(),
      account: String(work.account || '').trim(),
      group_id: Number(work.groupId) || 0,
      group_name: String(work.groupName || '').trim(),
      owner: String(work.owner || '').trim(),
      platform: String(work.platform || '').trim(),
      title: String(work.title || '').trim(),
      publish_at: String(work.publishAt || '').trim(),
      publish_date: publishDate || '',
      publish_month: publishDate ? publishDate.slice(0, 7) : '',
      views: Number(work.views) || 0,
      likes: Number(work.likes) || 0,
      comments: Number(work.comments) || 0,
      favorites: Number(work.favorites) || 0,
      shares: Number(work.shares) || 0,
      fan_gain: Number(work.fanGain) || 0,
      completion_rate: Number(work.completionRate) || 0,
      interaction_rate: Number(work.interactionRate) || 0,
      hot_index: Number(work.hotIndex) || 0,
      hidden_by_zero_views: work.hiddenByZeroViews ? 1 : 0,
      video_duration_seconds: Number(work.videoDurationSeconds) || 0,
      video_duration_text: String(work.videoDurationText || '').trim(),
      video_length_type: String(work.videoLengthType || '').trim(),
      content_type: String(work.contentType || '').trim(),
      business_kind: String(work.businessKind || '').trim(),
      business_source: String(work.businessSource || '').trim(),
      business_reason: String(work.businessReason || '').trim(),
      source_file: String(work.sourceFile || '').trim(),
      summary_file: String(work.summaryFile || '').trim(),
      collected_at: String(work.collectedAt || '').trim(),
      raw_json: JSON.stringify(work || {})
    };
  }

  function migrateHistoryWorkColumns(db, cb) {
    const statements = [
      'ALTER TABLE account_data_works ADD COLUMN video_duration_seconds INTEGER DEFAULT 0',
      'ALTER TABLE account_data_works ADD COLUMN video_duration_text TEXT DEFAULT ""',
      'ALTER TABLE account_data_works ADD COLUMN video_length_type TEXT DEFAULT ""'
    ];
    let index = 0;
    function next(error) {
      if (error && !/duplicate column name/i.test(error.message || String(error))) return cb(error);
      if (index >= statements.length) return cb(null);
      db.run(statements[index++], next);
    }
    next();
  }

  function persistHistoryWorks(works) {
    return new Promise(resolve => {
      const rows = (works || []).map(normalizeHistoryWorkRow).filter(row => row.key && row.profile && row.platform && row.publish_month);
      if (!rows.length || !sqlite3) return resolve({ ok: false, skipped: true, count: 0 });
      fs.mkdirSync(path.dirname(historyDbFile), { recursive: true });
      const db = new sqlite3.Database(historyDbFile, error => {
        if (error) return resolve({ ok: false, error: error.message });
        try { db.configure('busyTimeout', 8000); } catch (e) {}
        db.serialize(() => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS account_data_works (
              key TEXT PRIMARY KEY,
              profile TEXT NOT NULL,
              canonical_profile TEXT DEFAULT '',
              account_id TEXT DEFAULT '',
              account TEXT DEFAULT '',
              group_id INTEGER DEFAULT 0,
              group_name TEXT DEFAULT '',
              owner TEXT DEFAULT '',
              platform TEXT NOT NULL,
              title TEXT DEFAULT '',
              publish_at TEXT DEFAULT '',
              publish_date TEXT DEFAULT '',
              publish_month TEXT DEFAULT '',
              views INTEGER DEFAULT 0,
              likes INTEGER DEFAULT 0,
              comments INTEGER DEFAULT 0,
              favorites INTEGER DEFAULT 0,
              shares INTEGER DEFAULT 0,
              fan_gain INTEGER DEFAULT 0,
              completion_rate REAL DEFAULT 0,
              interaction_rate REAL DEFAULT 0,
              hot_index INTEGER DEFAULT 0,
              hidden_by_zero_views INTEGER DEFAULT 0,
              video_duration_seconds INTEGER DEFAULT 0,
              video_duration_text TEXT DEFAULT '',
              video_length_type TEXT DEFAULT '',
              content_type TEXT DEFAULT '',
              business_kind TEXT DEFAULT '',
              business_source TEXT DEFAULT '',
              business_reason TEXT DEFAULT '',
              source_file TEXT DEFAULT '',
              summary_file TEXT DEFAULT '',
              collected_at TEXT DEFAULT '',
              first_seen_at TEXT DEFAULT '',
              last_seen_at TEXT DEFAULT '',
              raw_json TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_account_data_works_month ON account_data_works(publish_month);
            CREATE INDEX IF NOT EXISTS idx_account_data_works_account_month ON account_data_works(account_id, platform, publish_month);
            CREATE INDEX IF NOT EXISTS idx_account_data_works_platform_month ON account_data_works(platform, publish_month);
          `, execError => {
            if (execError) {
              try { db.close(); } catch (e) {}
              resolve({ ok: false, error: execError.message });
              return;
            }
            migrateHistoryWorkColumns(db, migrateError => {
              if (migrateError) {
                try { db.close(); } catch (e) {}
                resolve({ ok: false, error: migrateError.message });
                return;
              }
            db.run('BEGIN TRANSACTION', beginError => {
              if (beginError) {
                try { db.close(); } catch (e) {}
                resolve({ ok: false, error: beginError.message });
                return;
              }
              const stmt = db.prepare(`
                INSERT INTO account_data_works (
                  key, profile, canonical_profile, account_id, account, group_id, group_name, owner, platform,
                  title, publish_at, publish_date, publish_month, views, likes, comments, favorites, shares, fan_gain,
                  completion_rate, interaction_rate, hot_index, hidden_by_zero_views, video_duration_seconds, video_duration_text, video_length_type, content_type, business_kind,
                  business_source, business_reason, source_file, summary_file, collected_at, first_seen_at, last_seen_at, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT first_seen_at FROM account_data_works WHERE key=?), ?), ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  profile=excluded.profile,
                  canonical_profile=excluded.canonical_profile,
                  account_id=excluded.account_id,
                  account=excluded.account,
                  group_id=excluded.group_id,
                  group_name=excluded.group_name,
                  owner=excluded.owner,
                  platform=excluded.platform,
                  title=excluded.title,
                  publish_at=excluded.publish_at,
                  publish_date=excluded.publish_date,
                  publish_month=excluded.publish_month,
                  views=MAX(account_data_works.views, excluded.views),
                  likes=MAX(account_data_works.likes, excluded.likes),
                  comments=MAX(account_data_works.comments, excluded.comments),
                  favorites=MAX(account_data_works.favorites, excluded.favorites),
                  shares=MAX(account_data_works.shares, excluded.shares),
                  fan_gain=excluded.fan_gain,
                  completion_rate=excluded.completion_rate,
                  interaction_rate=excluded.interaction_rate,
                  hot_index=MAX(account_data_works.hot_index, excluded.hot_index),
                  hidden_by_zero_views=excluded.hidden_by_zero_views,
                  video_duration_seconds=excluded.video_duration_seconds,
                  video_duration_text=excluded.video_duration_text,
                  video_length_type=excluded.video_length_type,
                  content_type=excluded.content_type,
                  business_kind=excluded.business_kind,
                  business_source=excluded.business_source,
                  business_reason=excluded.business_reason,
                  source_file=excluded.source_file,
                  summary_file=excluded.summary_file,
                  collected_at=excluded.collected_at,
                  last_seen_at=excluded.last_seen_at,
                  raw_json=excluded.raw_json
              `);
              const now = new Date().toISOString();
              rows.forEach(row => {
                stmt.run([
                  row.key, row.profile, row.canonical_profile, row.account_id, row.account, row.group_id, row.group_name, row.owner, row.platform,
                  row.title, row.publish_at, row.publish_date, row.publish_month, row.views, row.likes, row.comments, row.favorites, row.shares, row.fan_gain,
                  row.completion_rate, row.interaction_rate, row.hot_index, row.hidden_by_zero_views, row.video_duration_seconds, row.video_duration_text, row.video_length_type, row.content_type, row.business_kind,
                  row.business_source, row.business_reason, row.source_file, row.summary_file, row.collected_at, row.key, now, now, row.raw_json
                ]);
              });
              stmt.finalize(finalizeError => {
                if (finalizeError) {
                  db.run('ROLLBACK', () => {
                    try { db.close(); } catch (e) {}
                    resolve({ ok: false, error: finalizeError.message });
                  });
                  return;
                }
                db.run('COMMIT', commitError => {
                  try { db.close(); } catch (e) {}
                  resolve(commitError ? { ok: false, error: commitError.message } : { ok: true, count: rows.length });
                });
              });
            });
            });
          });
        });
      });
    });
  }

  function historyWorkFromDb(row) {
    const raw = (() => {
      try { return JSON.parse(row.raw_json || '{}'); } catch (e) { return {}; }
    })();
    const videoLengthType = row.video_length_type || raw.videoLengthType || 'unknown';
    return {
      id: row.key,
      profile: row.profile,
      accountId: row.account_id,
      account: row.account,
      groupId: Number(row.group_id) || 0,
      groupName: row.group_name,
      owner: row.owner,
      platform: row.platform,
      platformLabel: platformLabels[row.platform] || row.platform,
      title: row.title || '?????',
      contentType: row.content_type || '??',
      businessKind: row.business_kind || '',
      businessSource: row.business_source || '',
      businessReason: row.business_reason || '',
      businessSignals: [],
      videoDurationSeconds: Number(row.video_duration_seconds) || Number(raw.videoDurationSeconds) || 0,
      videoDurationText: row.video_duration_text || raw.videoDurationText || '',
      videoLengthType,
      videoLengthLabel: videoLengthLabel(videoLengthType),
      publishAt: row.publish_at,
      publishDate: row.publish_date,
      views: Number(row.views) || 0,
      hiddenByZeroViews: Boolean(row.hidden_by_zero_views),
      likes: Number(row.likes) || 0,
      comments: Number(row.comments) || 0,
      favorites: Number(row.favorites) || 0,
      shares: Number(row.shares) || 0,
      fanGain: Number(row.fan_gain) || 0,
      completionRate: Number(row.completion_rate) || 0,
      interactionRate: Number(row.interaction_rate) || 0,
      hotIndex: Number(row.hot_index) || 0,
      level: Number(row.views) >= 100000 || Number(row.likes) >= 5000 ? 'S?' : Number(row.views) >= 30000 || Number(row.likes) >= 1000 ? 'A?' : Number(row.views) >= 8000 ? 'B?' : '??',
      sourceFile: row.source_file || '',
      summaryFile: row.summary_file || '',
      collectedAt: row.collected_at || ''
    };
  }

  async function readHistoryWorks(period) {
    const month = String(period && period.month || '').trim();
    if (!/^20\d{2}-\d{2}$/.test(month)) return [];
    await ensureAccountDataHistoryDb();
    const rows = await sqliteAll(historyDbFile, 'SELECT * FROM account_data_works WHERE publish_month=? ORDER BY publish_date DESC, views DESC', [month]);
    return rows.map(historyWorkFromDb);
  }

  function normalizeWorkRow(platform, row, index, account, businessContext) {
    const title = String(pickByHeader(row, [/作品名称/, /作品标题/, /^作品$/, /视频标题/, /视频名称/, /^标题$/, /^title$/i]) || '').trim();
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
    const duration = extractVideoDuration(row);
    const hiddenByZeroViews = views === 0;
    return {
      id: [account.profile, platform, index, title || publishAt].join('-'),
      profile: account.profile,
      account: account.account,
      groupId: account.groupId,
      groupName: account.groupName,
      owner: account.owner,
      primaryPlatform: account.primaryPlatform || '',
      platform,
      platformLabel: platformLabels[platform] || platform,
      title: title || '未命名作品',
      contentType: business.type,
      businessKind: business.businessKind,
      businessSource: business.businessSource,
      businessReason: business.businessReason,
      businessSignals: business.businessSignals,
      videoDurationSeconds: duration.videoDurationSeconds,
      videoDurationText: duration.videoDurationText,
      videoLengthType: duration.videoLengthType,
      videoLengthLabel: duration.videoLengthLabel,
      publishAt,
      publishDate: dateKey(publishAt),
      views,
      hiddenByZeroViews,
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

  function sourceRowCount(sources) {
    return (sources || []).reduce((sum, source) => sum + (Number(source && source.rows) || 0), 0);
  }

  function hasDashboardBucketData(item) {
    return sourceRowCount(item.sources) > 0 ||
      (item.works || []).length > 0 ||
      (item.fanTrendRows || []).length > 0;
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
        primaryPlatform: meta.primaryPlatform || '',
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
        rows: rows.length,
        source: entry.dataset.source,
        scope: entry.dataset.sourceScope || '',
        collectedAt: entry.summaryFinishedAt || entry.summaryStartedAt || ''
      });
      if (entry.dataset.dataset === 'works') {
        current.works = rows.map((row, index) => Object.assign(normalizeWorkRow(entry.dataset.platform, row, index, current, businessContext), {
          sourceFile: entry.dataset.file,
          summaryFile: entry.summaryFile,
          collectedAt: entry.summaryFinishedAt || entry.summaryStartedAt || ''
        }));
      }
      if (entry.dataset.dataset === 'fans') {
        current.fanTrendRows = normalizeFanTrend(entry.dataset.platform, rows);
      }
      bucket.set(key, current);
    });

    const accounts = [];
    const works = [];
    const unmapped = [];
    bucket.forEach(item => {
      if (!hasDashboardBucketData(item)) return;
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
      const countedWorkRows = publishVolumeExcludedAccount ? [] : workRows.filter(row => !row.hiddenByZeroViews);
      const hiddenWorkRows = publishVolumeExcludedAccount ? [] : workRows.filter(row => row.hiddenByZeroViews);
      accounts.push({
        id,
        accountId: item.canonicalProfile || item.profile,
        account: item.account,
        groupId: item.groupId,
        groupName: item.groupName,
        owner: item.owner,
        primaryPlatform: item.primaryPlatform || '',
        knownProfile: item.knownProfile,
        platform: item.platform,
        platformLabel: item.platformLabel,
        enabled: true,
        profile: item.profile,
        publishVolumeExcluded: publishVolumeExcludedAccount,
        collectStatus: item.sources.length ? '已采集' : '待采集',
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
        hiddenTotal: hiddenWorkRows.length,
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

    const existingAccountIds = new Set(accounts.map(account => account.id));
    for (const catalogAccount of publishAccountCatalog()) {
      for (const platform of catalogAccount.platforms || []) {
        if (!dashboardPlaceholderPlatforms.has(platform.id)) continue;
        if (platform.account_data_collect_enabled === false) continue;
        const collectStatus = platform.collect_status || platform.status || platform.login_status || '';
        const isUnboundPlaceholder = !String(platform.profile_alias || platform.profile || '').trim()
          || collectStatus === 'profile_not_connected';
        if (platform.runnable === false && !isUnboundPlaceholder) continue;
        const accountId = catalogAccount.id;
        const id = [platform.id, accountId].join('-');
        if (existingAccountIds.has(id)) continue;
        accounts.push({
          id,
          accountId,
          account: catalogAccount.dashboardName || catalogAccount.name,
          groupId: Number(catalogAccount.groupId) || 0,
          groupName: catalogAccount.groupName || '待确认分组',
          owner: catalogAccount.owner || '',
          knownProfile: true,
          platform: platform.id,
          platformLabel: platformLabels[platform.id] || platform.id,
          enabled: true,
          profile: platform.profile_alias || platform.profile || '',
          publishVolumeExcluded: publishVolumeExcluded(platform.profile_alias || platform.profile, platform.id),
          collectStatus: collectStatus || '待采集',
          collectStatusReason: platform.collect_status_reason || '账号池已绑定，但本次没有有效作品/粉丝数据',
          lastCollectedAt: platform.collect_status_checked_at || '',
          totalViews: 0,
          yesterdayViews: 0,
          totalLikes: 0,
          yesterdayLikes: 0,
          followers: 0,
          followerDelta: 0,
          comments: 0,
          favorites: 0,
          shares: 0,
          hitWorks: 0,
          postTotal: 0,
          hiddenTotal: 0,
          growthScore: 0,
          completionValue: 0,
          trend: Array(8).fill(0),
          likeTrend: Array(8).fill(0),
          fanTrend: Array(8).fill(0),
          latestWorkDate: '',
          metricsByRange: buildMetricsByRange([], [], 0, new Date()),
          scopeLabel: scopeLabelFor(platform.id, []),
          sources: []
        });
        existingAccountIds.add(id);
      }
    }

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
      accountPlatformStatus: safeReadJson(path.join(root, 'data', 'account-platform-status.json')) || { profiles: {} },
      collectionFailures: buildCollectionFailures(12),
      businessRecognition: {
        ok: true,
        mode: 'platform_order_first',
        refs: ((businessContext && businessContext.refs) || []).length,
        rule: '平台字段优先；其次匹配排期/流水；只把抖音和B站主平台命中项计入商单'
      },
      businessOrderCounts: Array.isArray(businessContext && businessContext.businessOrderCounts)
        ? businessContext.businessOrderCounts
        : []
    };
  }

  return {
    _startCollectScheduler: startCollectScheduler,

    '/api/account-data/dashboard': function(body, reply) {
      if (!XLSX) return reply({ ok: false, error: '?? xlsx ??????????????' });
      const workScope = body && body.workScope === 'all' ? 'all' : 'month';
      const requestStartedAt = Date.now();
      console.log('[account-data] dashboard request started', { workScope, forceRefresh: Boolean(body && body.forceRefresh) });
      readDashboard({ forceRefresh: Boolean(body && body.forceRefresh) })
        .then(async result => {
          const month = String(body && body.historyMonth || '').trim();
          const responseMode = String(body && body.responseMode || 'full');
          if (!month && !body.forceRefresh && (responseMode === 'summary' || responseMode === 'publish-works')) {
            const snapshot = currentDashboardSnapshot();
            const scope = snapshot && snapshot.scopes && snapshot.scopes[workScope];
            if (scope) {
              if (responseMode === 'summary' && scope.summary) return reply(scope.summary);
              if (responseMode === 'publish-works' && Array.isArray(scope.publishWorks)) {
                return reply({ ok: true, works: scope.publishWorks, worksTotal: scope.publishWorks.length });
              }
            }
          }
          let payload;
          if (/^20\d{2}-\d{2}$/.test(month)) {
            const historyWorks = await readHistoryWorks({ month });
            payload = compactDashboardPayload(Object.assign({}, result, {
              historyMode: true,
              historyMonth: month,
              works: historyWorks,
              historyStore: Object.assign({}, result.historyStore || {}, { enabled: true, month, rows: historyWorks.length })
            }), 'all');
          } else {
            payload = compactDashboardPayload(result, workScope);
          }
          if (responseMode === 'summary' || responseMode === 'publish-works') {
            const fullWorks = Array.isArray(payload.works) ? payload.works : [];
            const worksTotal = fullWorks.length;
            const summaryWorks = compactPublishWorks(fullWorks);
            if (responseMode === 'publish-works') {
              return reply({ ok: true, works: summaryWorks, worksTotal });
            }
            return reply(Object.assign({}, payload, {
              works: [],
              worksTotal,
              worksDeferred: worksTotal > 0,
              publishStats: buildPublishStats(payload)
            }));
          }
          if (responseMode === 'works') {
            const works = Array.isArray(payload.works) ? payload.works : [];
            const offset = Math.max(0, Number(body && body.worksOffset) || 0);
            const limit = Math.max(1, Math.min(500, Number(body && body.worksLimit) || 250));
            return reply({
              ok: true,
              works: works.slice(offset, offset + limit),
              worksTotal: works.length,
              worksOffset: offset,
              worksLimit: limit
            });
          }
          if (responseMode === 'publish-detail') {
            const startDate = String(body && body.startDate || '').slice(0, 10);
            const endDate = String(body && body.endDate || startDate).slice(0, 10);
            const works = (Array.isArray(payload.works) ? payload.works : []).filter(function(work) {
              const date = String(work && (work.publishDate || dateKey(work.publishAt)) || '').slice(0, 10);
              return date && date >= startDate && date <= endDate;
            });
            return reply({ ok: true, works, startDate, endDate });
          }
          console.log('[account-data] dashboard request ready', {
            durationMs: Date.now() - requestStartedAt,
            accounts: Array.isArray(payload && payload.accounts) ? payload.accounts.length : 0,
            works: Array.isArray(payload && payload.works) ? payload.works.length : 0
          });
          reply(payload);
        })
        .catch(error => {
          console.warn('[account-data] dashboard read failed', error && error.stack || error);
          reply(compactDashboardPayload(buildDashboard({ refs: [] }), workScope));
        });
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
    },

    '/api/account-data/profile-login/open': function(body, reply) {
      openProfileLogin(body || {})
        .then(result => reply(result))
        .catch(err => reply({ ok: false, error: err && err.message ? err.message : String(err || '打开登录页失败') }));
    },

    '/api/account-data/profile-login/close': function(body, reply) {
      closeProfileLogin(body || {})
        .then(result => reply(result))
        .catch(err => reply({ ok: false, error: err && err.message ? err.message : String(err || '关闭登录窗口失败') }));
    }
  };
};

