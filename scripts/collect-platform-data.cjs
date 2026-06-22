const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');
const {
  chromeProfileDirectoryMap,
  dataMaintenanceProfile,
  dataProfileAliasForAccountKey,
  openCliBrowserProfileAliases
} = require('../server/lib/accountCatalog.cjs');

const ROOT = path.resolve(__dirname, '..');
const OPENCLI_MAIN = process.env.OPENCLI_MAIN ||
  path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
const DOWNLOADS = process.env.DOWNLOADS_DIR || path.join(process.env.USERPROFILE || '', 'Downloads');
const OPENCLI_EXTENSION_DIR = process.env.OPENCLI_EXTENSION_DIR
  || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');
const chromeProfileByOpenCli = chromeProfileDirectoryMap();

const args = parseArgs(process.argv.slice(2));
const requestedProfile = args.profile || dataMaintenanceProfile.alias;
const profileMode = String(args.profileMode || args.profile_mode || 'direct').trim().toLowerCase();
let profile = (profileMode === 'data' || profileMode === 'maintenance')
  ? dataProfileAliasForAccountKey(requestedProfile)
  : requestedProfile;
const sessionPrefix = args.sessionPrefix || `data-collect-${Date.now()}`;
const artifactPrefix = String(args.artifactPrefix || sessionPrefix || `data-collect-${Date.now()}`)
  .replace(/[^a-zA-Z0-9_.-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || `data-collect-${Date.now()}`;
const outDir = path.resolve(ROOT, args.outDir || path.join('data', 'data-export-tests'));
const days = Number(args.days || 30);
const platforms = splitArg(args.platforms || 'douyin,kuaishou,bilibili');
const datasets = splitArg(args.datasets || 'fans,works');
const activeBrowserSessions = new Set();
const openCliAliases = openCliBrowserProfileAliases();
const browserOpenTimeoutMs = Number(args.browserOpenTimeoutMs || process.env.ACCOUNT_DATA_BROWSER_OPEN_TIMEOUT_MS || 120000);
const browserEvalTimeoutMs = Number(args.browserEvalTimeoutMs || process.env.ACCOUNT_DATA_BROWSER_EVAL_TIMEOUT_MS || 120000);
const browserClickTimeoutMs = Number(args.browserClickTimeoutMs || process.env.ACCOUNT_DATA_BROWSER_CLICK_TIMEOUT_MS || 60000);
const postOpenWaitMs = Number(args.postOpenWaitMs || process.env.ACCOUNT_DATA_POST_OPEN_WAIT_MS || 2000);
const downloadTimeoutMs = Number(args.downloadTimeoutMs || process.env.ACCOUNT_DATA_DOWNLOAD_TIMEOUT_MS || 180000);
const skipDisconnected = args.skipDisconnected !== 'false' && process.env.ACCOUNT_DATA_SKIP_DISCONNECTED !== 'false';

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    parsed[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return parsed;
}

function splitArg(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function run(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      windowsHide: true,
      env: Object.assign({}, process.env, {
        NO_UPDATE_NOTIFIER: '1',
        npm_config_update_notifier: 'false',
        OPENCLI_NO_UPDATE_NOTIFIER: '1',
        CI: process.env.CI || '1'
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      reject(new Error(`timeout: ${command} ${argv.join(' ')}`));
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
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

function platformUrl(platformId) {
  if (platformId === 'douyin') return 'https://creator.douyin.com/creator-micro/content/upload';
  if (platformId === 'kuaishou') return 'https://cp.kuaishou.com/statistics/article';
  if (platformId === 'bilibili') return 'https://member.bilibili.com/platform/data-up/video?tab=audience';
  if (platformId === 'xiaohongshu') return 'https://creator.xiaohongshu.com/publish/publish';
  if (platformId === 'wechatVideo') return 'https://channels.weixin.qq.com/platform/post/create';
  return 'about:blank';
}

function parseOpenCliProfiles(text) {
  let disconnected = false;
  return String(text || '').split(/\r?\n/).map(line => {
    const raw = String(line || '').trim();
    if (!raw || /^Update available:|^Run:|^Download:|^Extension update available:/i.test(raw)) return null;
    if (/No Browser Bridge profiles connected|Open a Chrome profile/i.test(raw)) return null;
    if (/Disconnected saved profiles/i.test(raw)) {
      disconnected = true;
      return null;
    }
    if (/Connected Browser Bridge profiles/i.test(raw)) {
      disconnected = false;
      return null;
    }
    const parts = raw.split(/\s+(?:\u2014|\u2013|-)\s+/);
    let left = '';
    let right = '';
    if (parts.length >= 2) {
      left = parts[0].trim();
      right = parts.slice(1).join(' - ').trim();
    } else {
      const match = raw.match(/^\s*(\S+)\s+(.*)$/);
      if (!match) return null;
      left = match[1];
      right = match[2] || '';
    }
    const leftMatch = left.match(/^(\S+)(?:\s+(.*))?$/);
    if (!leftMatch) return null;
    const aliasFromRight = (right.match(/alias[:\uFF1A]\s*([^\s]+)/i) || [])[1] || '';
    return {
      context_id: leftMatch[1],
      alias: (leftMatch[2] || aliasFromRight || '').trim(),
      connected: !disconnected && /connected/i.test(right) && !/not connected|disconnected/i.test(right),
      raw
    };
  }).filter(Boolean);
}

async function listOpenCliProfiles() {
  const result = await run(process.execPath, [OPENCLI_MAIN, 'profile', 'list'], { timeoutMs: 30000 });
  const text = String(result.stdout || '') + '\n' + String(result.stderr || '');
  return parseOpenCliProfiles(text);
}

async function isProfileConnected(alias) {
  const profiles = await listOpenCliProfiles().catch(() => []);
  return Boolean(findConnectedProfile(profiles, alias));
}

function profileCandidates(alias) {
  const wanted = String(alias || '').trim();
  const candidates = new Set(wanted ? [wanted] : []);
  if (wanted && openCliAliases[wanted]) candidates.add(String(openCliAliases[wanted]).trim());
  Object.entries(openCliAliases).forEach(([name, contextId]) => {
    if (String(contextId || '').trim() === wanted && name) candidates.add(String(name).trim());
  });
  return candidates;
}

function findConnectedProfile(profiles, alias) {
  const candidates = profileCandidates(alias);
  return (profiles || []).find(item => item && item.connected && (
    candidates.has(String(item.alias || '').trim())
    || candidates.has(String(item.context_id || '').trim())
  )) || null;
}

async function launchChromeProfile(profileAlias, platformId) {
  const profileDirectory = chromeProfileByOpenCli[profileAlias];
  if (!profileDirectory) return { ok: false, skipped: true, error: `no chrome profile mapping for ${profileAlias}` };
  const launchArgs = [
    '--new-window',
    `--user-data-dir=${chromeUserDataDir()}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--profile-directory=${profileDirectory}`
  ];
  if (fs.existsSync(path.join(OPENCLI_EXTENSION_DIR, 'manifest.json'))) {
    launchArgs.push(`--load-extension=${OPENCLI_EXTENSION_DIR}`);
  }
  launchArgs.push(platformUrl(platformId));
  const child = spawn(chromeBin(), launchArgs, {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { ok: true, profileDirectory, extensionDir: fs.existsSync(path.join(OPENCLI_EXTENSION_DIR, 'manifest.json')) ? OPENCLI_EXTENSION_DIR : '' };
}

async function ensureOpenCliProfile(platformId) {
  if (args.launchProfile === 'false') return { ok: true, skipped: true };
  const beforeProfiles = await listOpenCliProfiles().catch(() => []);
  if (findConnectedProfile(beforeProfiles, profile)) {
    return { ok: true, connected: true, resolvedProfile: profile };
  }
  const beforeIds = new Set((beforeProfiles || []).map(item => String(item && item.context_id || '').trim()).filter(Boolean));
  const launched = await launchChromeProfile(profile, platformId);
  if (!launched.ok) return launched;
  const deadline = Date.now() + Number(args.profileConnectTimeoutMs || 45000);
  while (Date.now() < deadline) {
    await wait(1000);
    const profiles = await listOpenCliProfiles().catch(() => []);
    const aliased = findConnectedProfile(profiles, profile);
    if (aliased) return { ok: true, connected: true, launched, resolvedProfile: profile };
    const newlyConnected = args.allowNewContextFallback === 'true'
      ? profiles.find(item => item && item.connected && item.context_id && !beforeIds.has(String(item.context_id).trim()))
      : null;
    if (newlyConnected) {
      profile = String(newlyConnected.context_id || newlyConnected.alias || profile).trim() || profile;
      return { ok: true, connected: true, launched, resolvedProfile: profile, detectedContextId: newlyConnected.context_id };
    }
  }
  return { ok: false, launched, error: `profile not connected after launch: ${profile}` };
}

async function opencli(argv, timeoutMs = 30000) {
  if (!fs.existsSync(OPENCLI_MAIN)) throw new Error(`opencli main not found: ${OPENCLI_MAIN}`);
  const result = await run(process.execPath, [OPENCLI_MAIN, '--profile', profile].concat(argv), { timeoutMs });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.code !== 0) throw new Error(`opencli failed: ${argv.join(' ')}\n${output}`);
  return result.stdout && String(result.stdout).trim() ? result.stdout : output;
}

async function opencliQuiet(argv, timeoutMs = 30000) {
  if (!fs.existsSync(OPENCLI_MAIN)) return { code: 1, stdout: '', stderr: `opencli main not found: ${OPENCLI_MAIN}` };
  return run(process.execPath, [OPENCLI_MAIN, '--profile', profile].concat(argv), { timeoutMs })
    .catch(err => ({ code: 1, stdout: '', stderr: err.message || String(err) }));
}

function extractJson(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(clean);
  } catch (_) {}
  const start = clean.search(/[\[{]/);
  if (start >= 0) {
    for (let end = clean.length; end > start; end -= 1) {
      const slice = clean.slice(start, end).trim();
      try {
        return JSON.parse(slice);
      } catch (_) {}
    }
  }
  for (const line of clean.split(/\r?\n/)) {
    const item = line.trim();
    if (!item || /^Update available|^Run:|^Extension update|^Download:/.test(item)) continue;
    try {
      return JSON.parse(item);
    } catch (_) {}
    if (!/[{}\[\]]/.test(item)) return item;
  }
  throw new Error(`invalid json output\n${clean.slice(0, 1000)}`);
}

function platformFromSession(session) {
  const value = String(session || '');
  if (/-dy-/.test(value)) return 'douyin';
  if (/-ks-/.test(value)) return 'kuaishou';
  if (/-bili-/.test(value)) return 'bilibili';
  if (/-xhs-/.test(value)) return 'xiaohongshu';
  return platforms[0] || 'douyin';
}

function isBridgeDisconnectError(err) {
  const text = String(err && err.message || err || '');
  return /not connected|connection dropped|Browser Bridge|profile not connected/i.test(text);
}

function normalizePageId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.page || value.targetId || value.target_id || value.id || '').trim();
}

function expectedUrlPattern(url) {
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  })();
  if (!host) return null;
  if (/douyin\.com$/i.test(host)) return /(^|\.)douyin\.com$/i;
  if (/kuaishou\.com$/i.test(host)) return /(^|\.)kuaishou\.com$/i;
  if (/bilibili\.com$/i.test(host)) return /(^|\.)bilibili\.com$/i;
  if (/xiaohongshu\.com$/i.test(host)) return /(^|\.)xiaohongshu\.com$/i;
  if (/weixin\.qq\.com$/i.test(host)) return /(^|\.)weixin\.qq\.com$/i;
  return new RegExp('(^|\\.)' + host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
}

function urlMatchesExpected(actualUrl, targetUrl) {
  const pattern = expectedUrlPattern(targetUrl);
  if (!pattern) return true;
  try {
    const actual = new URL(String(actualUrl || ''));
    if (!pattern.test(actual.hostname.replace(/^www\./, ''))) return false;
    const target = new URL(String(targetUrl || ''));
    if (/creator\.douyin\.com$/i.test(target.hostname) && target.pathname.startsWith('/creator-micro/data-center/')) {
      return actual.pathname.startsWith('/creator-micro/data-center/');
    }
    if (/member\.bilibili\.com$/i.test(target.hostname) && target.pathname.startsWith('/platform/data-up/')) {
      return actual.pathname.startsWith('/platform/data-up/');
    }
    if (/cp\.kuaishou\.com$/i.test(target.hostname) && target.pathname.startsWith('/statistics/')) {
      return actual.pathname.startsWith('/statistics/');
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function browserPageUrl(session, page) {
  try {
    return await browserEval(session, page, '(()=>location.href)()', 30000);
  } catch (_) {
    return '';
  }
}

async function waitForExpectedPage(session, page, url, timeoutMs) {
  const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 30000);
  let lastUrl = '';
  while (Date.now() < deadline) {
    lastUrl = String(await browserPageUrl(session, page) || '');
    if (urlMatchesExpected(lastUrl, url)) return { ok: true, url: lastUrl };
    await wait(1500);
  }
  return { ok: false, url: lastUrl };
}

async function waitForUrlMatch(session, page, predicateSource, timeoutMs = 10000) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 10000);
  let lastUrl = '';
  while (Date.now() < deadline) {
    const result = await browserEval(session, page, `(() => {
      const href = location.href;
      const ok = (${predicateSource})(href);
      return { ok, href };
    })()`, 15000).catch(() => ({ ok: false, href: '' }));
    lastUrl = String(result && result.href || '');
    if (result && result.ok) return { ok: true, url: lastUrl };
    await wait(500);
  }
  return { ok: false, url: lastUrl };
}

async function browserOpen(session, url) {
  let opened;
  try {
    try {
      opened = extractJson(await opencli(['browser', session, 'tab', 'new', url], browserOpenTimeoutMs));
    } catch (_) {
      opened = extractJson(await opencli(['browser', session, 'open', url], browserOpenTimeoutMs));
    }
  } catch (err) {
    if (!isBridgeDisconnectError(err) || args.reconnectOnDisconnect === 'false') throw err;
    const ensured = await ensureOpenCliProfile(platformFromSession(session));
    if (!ensured || ensured.ok === false) throw err;
    await wait(2500);
    try {
      opened = extractJson(await opencli(['browser', session, 'tab', 'new', url], browserOpenTimeoutMs));
    } catch (_) {
      opened = extractJson(await opencli(['browser', session, 'open', url], browserOpenTimeoutMs));
    }
  }
  let page = normalizePageId(opened);
  if (!page) throw new Error(`missing page id for ${url}`);
  let ready = await waitForExpectedPage(session, page, url, Math.min(browserOpenTimeoutMs, 45000));
  if (!ready.ok) {
    const reopened = extractJson(await opencli(['browser', session, 'open', '--tab', page, url], browserOpenTimeoutMs));
    page = normalizePageId(reopened) || page;
    ready = await waitForExpectedPage(session, page, url, Math.min(browserOpenTimeoutMs, 45000));
  }
  if (!ready.ok) {
    const navigated = await browserEval(session, page, `(() => { location.href = ${JSON.stringify(url)}; return location.href; })()`, 30000).catch(() => '');
    ready = await waitForExpectedPage(session, page, url, Math.min(browserOpenTimeoutMs, 45000));
    if (!ready.url && navigated) ready.url = navigated;
  }
  if (!ready.ok) throw new Error(`opened wrong page for ${url}: ${ready.url || 'unknown url'}`);
  activeBrowserSessions.add(session);
  return page;
}

async function closeBrowserSession(session) {
  if (!session) return { ok: false, error: 'missing session' };
  const result = await opencliQuiet(['browser', session, 'close'], 30000);
  activeBrowserSessions.delete(session);
  return {
    ok: result.code === 0,
    session,
    code: result.code,
    stderr: String(result.stderr || '').trim()
  };
}

async function closeActiveBrowserSessions() {
  const sessions = Array.from(activeBrowserSessions);
  const results = [];
  for (const session of sessions) {
    try {
      await opencli(['browser', session, 'tab', 'list'], 15000).catch(() => '');
    } catch (_) {}
    results.push(await closeBrowserSession(session));
  }
  return results;
}

async function closeChromeProfileDirectory(profileDirectory, reason) {
  if (!profileDirectory) return { ok: false, skipped: true, error: 'missing profile directory', reason: reason || '' };
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
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 30000 })
    .catch(err => ({ code: 1, stdout: '', stderr: err.message || String(err) }));
  return {
    ok: result.code === 0,
    code: result.code,
    profileDirectory,
    reason: reason || '',
    killedPids: String(result.stdout || '').trim().split(/\s+/).filter(Boolean),
    stderr: String(result.stderr || '').trim()
  };
}

async function browserEval(session, page, source, timeoutMs = browserEvalTimeoutMs) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = await opencli(['browser', session, 'eval', '--tab', page, source], timeoutMs);
      return extractJson(output);
    } catch (err) {
      lastError = err;
      const text = String(err && err.message || err || '');
      if (!/invalid json output|connection dropped|not connected/i.test(text) || attempt > 0) break;
      if (/not connected|connection dropped/i.test(text)) {
        const ensured = await ensureOpenCliProfile(platformFromSession(session)).catch(() => null);
        if (!ensured || ensured.ok === false) break;
      }
      await wait(2000);
    }
  }
  throw lastError;
}

async function browserState(session, page) {
  return opencli(['browser', session, 'state', '--tab', page], 30000);
}

async function browserClick(session, page, target, timeoutMs = browserClickTimeoutMs) {
  return extractJson(await opencli(['browser', session, 'click', '--tab', page, String(target)], timeoutMs));
}

async function clickVisibleText(session, page, texts, options = {}) {
  const words = Array.isArray(texts) ? texts : [texts];
  const selector = options.selector || 'button,[role=button],a,label,span,div';
  const exact = options.exact !== false;
  return browserEval(session, page, `(() => {
    const words = ${JSON.stringify(words)};
    const selector = ${JSON.stringify(selector)};
    const exact = ${JSON.stringify(exact)};
    const textOf = el => (el && (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '') || '').trim().replace(/\s+/g, ' ');
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map(el => ({ el, text: textOf(el) }))
      .filter(item => item.text)
      .sort((a, b) => a.text.length - b.text.length);
    let hit = nodes.find(item => words.some(word => item.text === word));
    if (!hit && !exact) hit = nodes.find(item => words.some(word => item.text.includes(word)));
    if (!hit) return { clicked: false };
    hit.el.click();
    return { clicked: true, text: hit.text.slice(0, 80), tag: hit.el.tagName, cls: String(hit.el.className || '').slice(0, 120) };
  })()`).catch(() => ({ clicked: false }));
}

async function clickTextByWalkingDom(session, page, text) {
  return browserEval(session, page, `(() => {
    const wanted = ${JSON.stringify(text)};
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const textOf = el => (el && (el.innerText || el.textContent || '') || '').trim().replace(/\s+/g, ' ');
    const nodes = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map(el => ({ el, text: textOf(el) }))
      .filter(item => item.text && item.text.includes(wanted))
      .sort((a, b) => a.text.length - b.text.length);
    const hit = nodes[0];
    if (!hit) return { clicked: false };
    let target = hit.el;
    for (let node = hit.el; node && node !== document.body; node = node.parentElement) {
      const role = node.getAttribute && node.getAttribute('role') || '';
      const cls = String(node.className || '');
      if (/button|tab|menu|item|link|nav/i.test(role + ' ' + cls) || ['A', 'BUTTON', 'LI'].includes(node.tagName)) {
        target = node;
        break;
      }
    }
    target.click();
    return { clicked: true, text: hit.text.slice(0, 120), tag: target.tagName, cls: String(target.className || '').slice(0, 120) };
  })()`).catch(() => ({ clicked: false }));
}

async function dismissKnownPopups(session, page) {
  const keywords = ['我知道了', '知道了', '知道啦', '跳过', '以后再说', '稍后再说', '暂不开启', '暂不认证', '我再想想', '关闭', '暂不', '取消', '同意', '确认', '确定', '完成'];
  for (let round = 0; round < 5; round += 1) {
    const domClicked = await browserEval(session, page, `(() => {
      const words = ${JSON.stringify(keywords)};
      const textOf = el => (el && (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '') || '').trim().replace(/\\s+/g, ' ');
      const visible = el => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const isModalish = el => {
        let node = el;
        for (let i = 0; node && i < 6; i += 1, node = node.parentElement) {
          const cls = String(node.className || '');
          const role = node.getAttribute && node.getAttribute('role') || '';
          if (/dialog|modal|popup|popover|overlay|mask|guide|tour|drawer/i.test(cls) || role === 'dialog') return true;
        }
        return false;
      };
      const candidates = Array.from(document.querySelectorAll('button,[role=button],a,span,div,i,svg'))
        .filter(visible)
        .map((el, index) => {
          const rect = el.getBoundingClientRect();
          return { el, index, text: textOf(el), cls: String(el.className || ''), x: rect.x, y: rect.y, w: rect.width, h: rect.height, modal: isModalish(el) };
        })
        .filter(item => item.modal || /close|cancel|confirm|button|btn|modal|dialog|popup/i.test(item.cls));
      const byText = candidates.find(item => words.some(word => item.text === word || item.text.includes(word)));
      const byIcon = candidates.find(item => item.modal && !item.text && item.w <= 60 && item.h <= 60 && (item.x > window.innerWidth * 0.55 || /close|icon-close|close-icon/i.test(item.cls)));
      const target = byText || byIcon;
      if (!target) return { clicked: false };
      target.el.click();
      return { clicked: true, text: target.text, cls: target.cls.slice(0, 120) };
    })()`).catch(() => ({ clicked: false }));
    if (domClicked && domClicked.clicked) {
      await wait(900);
      continue;
    }
    const state = await browserState(session, page).catch(() => '');
    let clicked = false;
    for (const keyword of keywords) {
      const ref = findRefNearText(state, keyword, { back: 8, forward: 4, occurrence: 1 });
      if (!ref) continue;
      await browserClick(session, page, ref).catch(() => null);
      clicked = true;
      await wait(800);
      break;
    }
    if (!clicked) break;
  }
}

function refFromLine(line) {
  const match = String(line || '').match(/\[(\d+)\]/);
  return match ? match[1] : '';
}

function findRefNearText(snapshot, text, opts = {}) {
  const rows = String(snapshot || '').split(/\r?\n/);
  const tags = opts.tags || [];
  const occurrence = opts.occurrence || 1;
  let seen = 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].includes(text)) continue;
    seen += 1;
    if (seen !== occurrence) continue;
    for (let i = index; i >= Math.max(0, index - (opts.back || 8)); i -= 1) {
      if (!tags.length || tags.some(tag => rows[i].includes(`<${tag}`))) {
        const ref = refFromLine(rows[i]);
        if (ref) return ref;
      }
    }
    for (let i = index; i <= Math.min(rows.length - 1, index + (opts.forward || 4)); i += 1) {
      const ref = refFromLine(rows[i]);
      if (ref) return ref;
    }
  }
  return '';
}

function writeWorkbook(filename, sheetName, rows) {
  fs.mkdirSync(outDir, { recursive: true });
  const full = path.join(outDir, `${artifactPrefix}-${filename}`);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(workbook, full);
  return full;
}

function inspectTableFile(file) {
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return { rows: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [], first: rows[0] || null };
}

function latestExcelSince(startMs) {
  if (!fs.existsSync(DOWNLOADS)) return null;
  return fs.readdirSync(DOWNLOADS)
    .filter(name => /\.(xlsx|xls|csv)$/i.test(name) && !/\.crdownload$/i.test(name))
    .map(name => {
      const full = path.join(DOWNLOADS, name);
      const stat = fs.statSync(full);
      return { full, stat };
    })
    .filter(item => item.stat.mtimeMs >= startMs && item.stat.size > 0)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
}

async function waitForDownload(startMs, timeoutMs = downloadTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = latestExcelSince(startMs);
    if (hit) {
      await wait(800);
      return hit;
    }
    await wait(800);
  }
  throw new Error('download timeout');
}

function copyDownload(downloaded, prefix) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(downloaded.full) || '.xlsx';
  const dest = path.join(outDir, `${artifactPrefix}-${prefix}-${stamp()}${ext}`);
  fs.copyFileSync(downloaded.full, dest);
  return dest;
}

function writeBinaryFile(filename, base64) {
  fs.mkdirSync(outDir, { recursive: true });
  const full = path.join(outDir, `${artifactPrefix}-${filename}`);
  fs.writeFileSync(full, Buffer.from(base64, 'base64'));
  return full;
}

function datasetResult(meta, startedAt, file, extra = {}) {
  let table = {};
  if (file && /\.(xlsx|xls)$/i.test(file)) table = inspectTableFile(file);
  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    file,
    rows: table.rows ?? extra.rows ?? null,
    columns: table.columns ?? extra.columns ?? [],
    first: table.first ?? extra.first ?? null,
    ...meta,
    ...extra
  };
}

async function writeDebugSnapshot(session, page, label) {
  const safeLabel = String(label || 'snapshot').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80) || 'snapshot';
  const snapshot = await browserEval(session, page, `(() => ({
    href: location.href,
    title: document.title,
    text: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 12000),
    buttons: Array.from(document.querySelectorAll('button,[role=button],label,[role=tab],a')).slice(0, 200).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role') || '',
      text: (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      cls: String(el.className || '').slice(0, 120)
    }))
  }))()`).catch(err => ({ error: err.message || String(err) }));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${artifactPrefix}-${safeLabel}-debug-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');
  return file;
}

function dateLabel(raw) {
  const text = String(raw || '');
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
}

async function collectDouyinFans() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-dy-fans`;
  const page = await browserOpen(session, 'https://creator.douyin.com/creator-micro/data-center/operation');
  await wait(postOpenWaitMs);
  await dismissKnownPopups(session, page);
  const payload = await browserEval(session, page, `(async()=>{const r=await fetch('/janus/douyin/creator/data/overview/dashboard',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({recent_days:${JSON.stringify(days)}})});const j=await r.json();return {ok:r.ok,status:r.status,status_code:j.status_code,status_msg:j.status_msg,metrics:j.metrics||[]};})()`);
  if (!payload.ok || payload.status_code !== 0) throw new Error(`douyin fans api failed: ${payload.status_msg || payload.status}`);
  const metrics = new Map((payload.metrics || []).map(item => [item.english_metric_name, item]));
  const dates = Array.from(new Set(Array.from(metrics.values()).flatMap(item => (item.trends || []).map(trend => trend.date_time)))).sort();
  const valueAt = (key, date) => {
    const hit = ((metrics.get(key) || {}).trends || []).find(item => item.date_time === date);
    return hit ? (hit.value ?? hit.douyin_value ?? '') : '';
  };
  const rows = dates.map(date => ({
    '日期': dateLabel(date),
    '总粉丝量': valueAt('total_fans_cnt', date),
    '净增粉丝量': valueAt('net_fans_cnt', date),
    '取关粉丝量': valueAt('cancel_fans_cnt', date),
    '主页访问': valueAt('homepage_view_cnt', date)
  }));
  const file = writeWorkbook(`douyin-fans-trend-${stamp()}.xlsx`, '抖音粉丝趋势', rows);
  return datasetResult({ platform: 'douyin', dataset: 'fans', source: 'api:overview/dashboard', page }, startedAt, file);
}

async function collectDouyinWorks() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-dy-works`;
  const page = await browserOpen(session, 'https://creator.douyin.com/creator-micro/data-center/content');
  await wait(postOpenWaitMs);
  await dismissKnownPopups(session, page);
  const contentUrl = await waitForUrlMatch(session, page, `href => /\/creator-micro\/data-center\/content/.test(href)`, 1000);
  if (!contentUrl.ok) {
    let clickedWorks = await clickVisibleText(session, page, '作品分析', { selector: 'a,button,[role=button],span,div', exact: true });
    if (!clickedWorks || !clickedWorks.clicked) clickedWorks = await clickTextByWalkingDom(session, page, '作品分析');
    if (clickedWorks && clickedWorks.clicked) {
      await waitForUrlMatch(session, page, `href => /\/creator-micro\/data-center\/content|\/creator-micro\/data-center/.test(href)`, 5000);
      await wait(500);
      await dismissKnownPopups(session, page);
    }
  }
  const domClicked = await clickVisibleText(session, page, '投稿列表', { selector: 'label,button,[role=tab],[role=button],span,div', exact: true });
  if (!domClicked || !domClicked.clicked) {
    const state = await browserState(session, page);
    const listRef = findRefNearText(state, '投稿列表', { tags: ['label', 'button'], back: 10, forward: 6 })
      || findRefNearText(state, '投稿列表', { back: 10, forward: 8 });
    if (!listRef) {
      const debugFile = await writeDebugSnapshot(session, page, 'douyin-works-list-missing');
      throw new Error(`douyin 投稿列表 ref not found; debug=${debugFile}`);
    }
    await browserClick(session, page, listRef);
  }
  await wait(1000);
  const state = await browserState(session, page);
  const exportRef = findRefNearText(state, '导出数据', { tags: ['button'], back: 8, forward: 3, occurrence: 1 });
  if (!exportRef) throw new Error('douyin 投稿列表导出数据 ref not found');
  const downloadStart = Date.now();
  await browserClick(session, page, exportRef);
  const downloaded = await waitForDownload(downloadStart);
  const file = copyDownload(downloaded, 'douyin-works-export');
  return datasetResult({ platform: 'douyin', dataset: 'works', source: 'official_export:content/post_list', page, downloaded: downloaded.full }, startedAt, file);
}

async function getKuaishouApiPh(session, page) {
  const existing = await browserEval(session, page, `(()=>{const reqs=(window.__codexKsReqs||[]).concat(window.__codexKsWorksReqs||[]);for(let i=reqs.length-1;i>=0;i--){try{const v=JSON.parse(reqs[i].body||'{}')['kuaishou.web.cp.api_ph'];if(v)return v;}catch(e){}}return '';})()`).catch(() => '');
  if (existing) return existing;
  await browserEval(session, page, `(()=>{window.__codexKsReqs=[];const oldFetch=window.fetch;window.fetch=function(input,init){try{window.__codexKsReqs.push({url:String(input&&input.url||input),method:init&&init.method,body:init&&init.body,ts:Date.now()});}catch(e){}return oldFetch.apply(this,arguments)};const OldXHR=window.XMLHttpRequest;window.XMLHttpRequest=function(){const xhr=new OldXHR();let u='',m='';const open=xhr.open;xhr.open=function(method,url){m=method;u=String(url);return open.apply(xhr,arguments)};const send=xhr.send;xhr.send=function(body){try{window.__codexKsReqs.push({url:u,method:m,body:typeof body==='string'?body:String(body),ts:Date.now()});}catch(e){}return send.apply(xhr,arguments)};return xhr;};return true;})()`);
  const state = await browserState(session, page);
  const near7 = findRefNearText(state, '近7天', { back: 4, forward: 2 }) || findRefNearText(state, '近30天', { back: 4, forward: 2 });
  if (near7) {
    await browserClick(session, page, near7).catch(() => null);
    await wait(1500);
  }
  const near30State = await browserState(session, page);
  const near30 = findRefNearText(near30State, '近30天', { back: 4, forward: 2 });
  if (near30) {
    await browserClick(session, page, near30).catch(() => null);
    await wait(2000);
  }
  const ph = await browserEval(session, page, `(()=>{const reqs=window.__codexKsReqs||[];for(let i=reqs.length-1;i>=0;i--){try{const v=JSON.parse(reqs[i].body||'{}')['kuaishou.web.cp.api_ph'];if(v)return v;}catch(e){}}return '';})()`);
  if (!ph) throw new Error('kuaishou api_ph not captured');
  return ph;
}

async function collectKuaishouFans() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-ks-fans`;
  const page = await browserOpen(session, 'https://cp.kuaishou.com/profile');
  await wait(postOpenWaitMs + 2000);
  await dismissKnownPopups(session, page);
  const loginState = await browserEval(session, page, `(()=>{const text=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');const hasConsole=/作品分析|数据概览|粉丝分析|内容管理|互动管理|发布作品/.test(text);return {needsLogin:!hasConsole&&/立即登录|扫码登录|验证码登录|密码登录/.test(text), hasConsole, text:text.slice(0,500)};})()`).catch(() => null);
  if (loginState && loginState.needsLogin) throw new Error('kuaishou needs login');
  const ph = await getKuaishouApiPh(session, page).catch(() => '');
  const payload = await browserEval(session, page, `(async()=>{const body={timeType:2};if(${JSON.stringify(Boolean(ph))})body['kuaishou.web.cp.api_ph']=${JSON.stringify(ph)};const r=await fetch('/rest/cp/creator/analysis/pc/home/author/overview',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(body)});const text=await r.text();let j={};try{j=JSON.parse(text)}catch(e){return {ok:r.ok,status:r.status,result:0,message:text.slice(0,200),data:null}}return {ok:r.ok,status:r.status,result:j.result,message:j.message,data:j.data};})()`);
  if (!payload.ok || payload.result !== 1) throw new Error(`kuaishou fans api failed: ${payload.message || payload.status}`);
  const metrics = new Map(((payload.data || {}).basicData || []).map(item => [item.tab, item]));
  const dates = Array.from(new Set(Array.from(metrics.values()).flatMap(item => (item.trendData || []).map(trend => trend.date)))).sort();
  const valueAt = (key, date) => {
    const hit = ((metrics.get(key) || {}).trendData || []).find(item => item.date === date);
    return hit ? hit.count : '';
  };
  const rows = dates.map(date => ({
    '日期': date,
    '播放量': valueAt('PLAY', date),
    '点赞量': valueAt('LIKE', date),
    '净增粉丝量': valueAt('PURE_INCREASE_FAN', date),
    '完播率': valueAt('COMPLETE_RATIO', date),
    '评论量': valueAt('COMMENT', date),
    '分享量': valueAt('SHARE', date)
  }));
  const file = writeWorkbook(`kuaishou-fans-trend-${stamp()}.xlsx`, '快手账号趋势', rows);
  return datasetResult({ platform: 'kuaishou', dataset: 'fans', source: 'api:home/author/overview', page }, startedAt, file);
}

async function collectKuaishouWorks() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-ks-works`;
  const page = await browserOpen(session, 'https://cp.kuaishou.com/statistics/article');
  await wait(postOpenWaitMs + 2000);
  await dismissKnownPopups(session, page);
  const loginState = await browserEval(session, page, `(()=>{const text=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');const hasConsole=/作品分析|数据概览|粉丝分析|内容管理|互动管理|发布作品/.test(text);return {needsLogin:!hasConsole&&/立即登录|扫码登录|验证码登录|密码登录/.test(text), hasConsole, text:text.slice(0,500)};})()`).catch(() => null);
  if (loginState && loginState.needsLogin) throw new Error('kuaishou needs login');
  let state = await browserState(session, page);
  if (!state.includes('作品分析')) {
    const worksRef = findRefNearText(state, '作品分析', { back: 8, forward: 3 });
    if (worksRef) await browserClick(session, page, worksRef);
    await wait(5000);
    state = await browserState(session, page);
  }
  const exportRef = findRefNearText(state, '导出数据', { back: 8, forward: 4, occurrence: 1 })
    || findRefNearText(state, '导出', { back: 8, forward: 4, occurrence: 1 });
  const ph = await getKuaishouApiPh(session, page).catch(() => '');
  const listMeta = await browserEval(session, page, `(async()=>{
    const body={orderType:2,sortType:1,type:0,count:10,page:0};
    if(${JSON.stringify(Boolean(ph))}) body['kuaishou.web.cp.api_ph']=${JSON.stringify(ph)};
    const r=await fetch('/rest/cp/creator/analysis/pc/photo/list',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(body)});
    const j=await r.json();
    const photoList=(j.data&&j.data.photoList)||{};
    return {ok:r.ok,result:j.result,totalCount:photoList.totalCount||0,pageCount:(photoList.photoItems||[]).length};
  })()`).catch(() => null);
  const before = await browserEval(session, page, `(async()=>{const body={page:0,count:10};if(${JSON.stringify(Boolean(ph))})body['kuaishou.web.cp.api_ph']=${JSON.stringify(ph)};return fetch('/rest/cp/creator/analysis/export/task/list',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(body)}).then(r=>r.json()).then(j=>(j.data&&j.data.list||[]).map(x=>x.taskId)).catch(()=>[]);})()`).catch(() => []);
  if (exportRef) {
    await browserClick(session, page, exportRef).catch(() => null);
    await wait(2500);
  }
  let latest = null;
  for (let i = 0; i < 30; i += 1) {
    const bodyExpr = ph ? `{page:0,count:10,'kuaishou.web.cp.api_ph':${JSON.stringify(ph)}}` : `{page:0,count:10}`;
    const list = await browserEval(session, page, `(async()=>{const r=await fetch('/rest/cp/creator/analysis/export/task/list',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(${bodyExpr})});const j=await r.json();return (j.data&&j.data.list||[]);})()`).catch(() => []);
    latest = (list || []).find(item => /作品/.test(item.filename || '') && item.status === 3 && !(before || []).includes(item.taskId)) ||
      (list || []).find(item => /作品/.test(item.filename || '') && item.status === 3);
    if (latest) break;
    if (!exportRef && i >= 2) break;
    await wait(2000);
  }
  if (!latest) throw new Error('kuaishou export task did not finish');
  const downloaded = await browserEval(session, page, `(async()=>{
    const taskId=${JSON.stringify(latest.taskId)};
    const findVue=(el)=>{
      if(!el)return null;
      const key=Object.keys(el).find(k=>k.startsWith('__vue__'));
      return key ? el[key] : (el.__vue__ || null);
    };
    let vm=findVue(document.querySelector('.download-center'));
    if(vm && !vm.download){
      const children=[...(vm.$children||[])];
      while(children.length && !vm.download){
        const item=children.shift();
        if(item && item.download){ vm=item; break; }
        if(item && item.$children) children.push(...item.$children);
      }
    }
    let opened='';
    const oldOpen=window.open;
    window.open=(url)=>{ opened=String(url||''); return null; };
    try{
      if(vm && vm.download){
        await vm.download(taskId);
      }else{
        const base=(window.location.origin || 'https://cp.kuaishou.com');
        const endpoints=[
          '/rest/cp/creator/analysis/export/task/download',
          '/rest/cp/creator/analysis/export/download',
          '/rest/cp/creator/analysis/export/task/download/url'
        ];
        for(const endpoint of endpoints){
          try{
            const r=await fetch(base+endpoint+'?taskId='+encodeURIComponent(taskId),{credentials:'include'});
            const text=await r.text();
            try{
              const j=JSON.parse(text);
              const url=(j.data&&typeof j.data==='object'&&(j.data.url||j.data.downloadUrl)) || (typeof j.data==='string'&&j.data) || j.url || j.downloadUrl;
              if(url){ opened=String(url); break; }
            }catch(e){
              if(/^https?:\\/\\//.test(text.trim())){ opened=text.trim(); break; }
            }
          }catch(e){}
        }
      }
    }finally{
      window.open=oldOpen;
    }
    if(!opened) return {ok:false,error:'download url not captured'};
    const downloadUrl=new URL(opened, window.location.origin).toString();
    const response=await fetch(downloadUrl,{credentials:'include'});
    const contentType=response.headers.get('content-type')||'';
    if(!response.ok) return {ok:false,error:'file download failed '+response.status, url:opened, contentType};
    const ab=await response.arrayBuffer();
    const bytes=new Uint8Array(ab);
    let binary='';
    for(let i=0;i<bytes.length;i+=0x8000){
      binary+=String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000));
    }
    return {
      ok:true,
      url:downloadUrl,
      contentType,
      base64:btoa(binary)
    };
  })()`, 120000);
  if (!downloaded.ok || !downloaded.base64) throw new Error(`kuaishou download failed: ${downloaded.error || 'empty file'}`);
  const ext = /\.csv$/i.test(latest.filename || '') ? '.csv' : '.xlsx';
  const safeName = `kuaishou-works-export-${stamp()}${ext}`;
  const file = writeBinaryFile(safeName, downloaded.base64);
  return datasetResult({
    platform: 'kuaishou',
    dataset: 'works',
    source: 'official_export:analysis/photo',
    sourceScope: '近90天最多1000条公开作品数据',
    page,
    listTotalCount: listMeta && listMeta.totalCount,
    listPageCount: listMeta && listMeta.pageCount,
    task: latest,
    downloaded: downloaded.url,
    contentType: downloaded.contentType
  }, startedAt, file);
}

async function collectBilibiliFans() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-bili-fans`;
  const page = await browserOpen(session, 'https://member.bilibili.com/platform/data-up/video?tab=audience');
  await wait(postOpenWaitMs + 2000);
  await dismissKnownPopups(session, page);
  const result = await browserEval(session, page, `(async()=>{const period=1;const r=await fetch('/x/web/data/v3/fans/stat/export?period='+period+'&tmid=&t='+Date.now(),{credentials:'include'});const j=await r.json();return {ok:r.ok,status:r.status,code:j.code,message:j.message,data:j.data};})()`, 60000);
  if (!result.ok || result.code !== 0) throw new Error(`bilibili fans export failed: ${result.status}/${result.code}`);
  const byDate = new Map();
  const add = (key, column) => {
    for (const item of ((result.data || {})[key] || [])) {
      const date = new Date(Number(item.date) * 1000).toISOString().slice(0, 10);
      const row = byDate.get(date) || { '日期': date };
      row[column] = item.fans_total_inc ?? '';
      byDate.set(date, row);
    }
  };
  add('data_tendency_total', '粉丝总数');
  add('data_tendency_follow', '新增关注');
  add('data_tendency_unfollow', '取消关注');
  add('data_tendency_active', '活跃粉丝');
  const rows = Array.from(byDate.values()).sort((a, b) => String(a['日期']).localeCompare(String(b['日期'])));
  const file = writeWorkbook(`bilibili-fans-trend-${stamp()}.xlsx`, 'B站粉丝趋势', rows);
  return datasetResult({ platform: 'bilibili', dataset: 'fans', source: 'api:fans/stat/export', page }, startedAt, file);
}

async function collectBilibiliWorks() {
  const startedAt = Date.now();
  const session = `${sessionPrefix}-bili-works`;
  const page = await browserOpen(session, 'https://member.bilibili.com/platform/data-up/video?tab=audience');
  await wait(postOpenWaitMs + 2000);
  await dismissKnownPopups(session, page);
  const result = await browserEval(session, page, `(async()=>{
    const all=[];
    const pageCounts=[];
    for(let pn=1;pn<=50;pn+=1){
      const url='/x/web/data/archive/index?pn='+pn+'&ps=20&scene=archive_compare&order=0&tmid=&t='+Date.now();
      const r=await fetch(url,{credentials:'include'});
      const j=await r.json();
      if(!r.ok || j.code!==0) return {ok:r.ok,status:r.status,code:j.code,message:j.message,all,pageCounts};
      const list=((j.data||{}).list)||[];
      pageCounts.push({pn,count:list.length});
      all.push(...list);
      if(list.length<20) break;
    }
    const compareSize=Math.max(10,Math.min(50,all.length||10));
    let compareList=[];
    try{
      const cr=await fetch('/x/web/data/archive_diagnose/compare?size='+compareSize+'&tmid=&t='+Date.now(),{credentials:'include'});
      const cj=await cr.json();
      if(cr.ok && cj.code===0) compareList=((cj.data||{}).list)||[];
    }catch(e){}
    const compareByBvid=new Map(compareList.map(item=>[item.bvid,item]));
    const rows=all.map(item=>{
      const compare=compareByBvid.get(item.bvid)||{};
      const stat=compare.stat||item.real_stat||item.stat||{};
      const baseStat=item.stat||{};
      const ratio=(value)=>value==null||value===''?'':(Number(value)/100).toFixed(1)+'%';
      return {
        '视频标题': item.title||'',
        'BVID': item.bvid||'',
        '发布时间': item.pubtime?new Date(item.pubtime*1000).toLocaleString('zh-CN',{hour12:false}):'',
        '时长秒': item.duration||'',
        '播放量': stat.play ?? baseStat.play ?? '',
        '游客播放占比': ratio(stat.play_viewer_rate),
        '粉丝观看率': ratio(stat.play_fan_rate),
        '涨粉量': stat.total_new_attention_cnt ?? stat.fans ?? baseStat.fans ?? '',
        '点赞量': stat.like ?? stat.likes ?? baseStat.likes ?? '',
        '评论量': stat.comment ?? stat.reply ?? baseStat.reply ?? '',
        '弹幕量': stat.dm ?? '',
        '收藏量': stat.fav ?? '',
        '投币量': stat.coin ?? '',
        '转发量': stat.share ?? '',
        '完播率': ratio(stat.full_play_ratio ?? baseStat.full_play_ratio),
        '平均播放进度': ratio(stat.tm_pass_rate),
        'VT': stat.vt ?? baseStat.vt ?? ''
      };
    });
    return {ok:true,status:200,code:0,rows,pageCounts,compareCount:compareList.length};
  })()`, 90000);
  if (!result.ok || result.code !== 0) throw new Error(`bilibili works list failed: ${result.status}/${result.code} ${result.message || ''}`);
  const file = writeWorkbook(`bilibili-works-list-${stamp()}.xlsx`, 'B站稿件列表', result.rows || []);
  return datasetResult({
    platform: 'bilibili',
    dataset: 'works',
    source: 'api:data-center/archive/index+archive_diagnose/compare',
    sourceScope: '数据中心稿件列表分页定量，诊断对比接口补充指标，非官方下载文件',
    page,
    pageCounts: result.pageCounts || [],
    compareCount: result.compareCount || 0
  }, startedAt, file, { rows: (result.rows || []).length, columns: result.rows && result.rows[0] ? Object.keys(result.rows[0]) : [] });
}

const collectors = {
  'douyin:fans': collectDouyinFans,
  'douyin:works': collectDouyinWorks,
  'kuaishou:fans': collectKuaishouFans,
  'kuaishou:works': collectKuaishouWorks,
  'bilibili:fans': collectBilibiliFans,
  'bilibili:works': collectBilibiliWorks
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const profileState = await ensureOpenCliProfile(platforms[0]).catch(err => ({ ok: false, error: err.message || String(err) }));
  const disconnected = Boolean(profileState && profileState.ok === false && /not connected|profile not connected/i.test(String(profileState.error || '')));
  const skipped = Boolean(skipDisconnected && disconnected);
  const summary = {
    ok: false,
    requestedProfile,
    profile,
    profileMode: profileMode || 'data',
    artifactPrefix,
    profileState,
    days,
    outDir,
    startedAt: new Date().toISOString(),
    datasets: [],
    lifecycle: {
      sessionCloses: [],
      profileClose: null
    },
    skipped,
    skipReason: skipped ? 'profile_not_connected' : ''
  };
  if (skipped) {
    const launchedProfileDirectory = profileState && profileState.launched && profileState.launched.profileDirectory;
    const profileDirectoryToClose = launchedProfileDirectory || chromeProfileByOpenCli[requestedProfile] || chromeProfileByOpenCli[profile];
    if (profileDirectoryToClose && args.closeProfile === 'true') {
      summary.lifecycle.profileClose = await closeChromeProfileDirectory(profileDirectoryToClose, 'data collection skipped before connection');
      console.error(`[lifecycle] close profile ${profileDirectoryToClose} ${summary.lifecycle.profileClose.ok ? 'ok' : 'failed'}`);
    }
    summary.finishedAt = new Date().toISOString();
    summary.ok = true;
    summary.summaryFile = path.join(outDir, `platform-data-summary-${artifactPrefix}-${stamp()}.json`);
    fs.writeFileSync(summary.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  for (const platform of platforms) {
    for (const dataset of datasets) {
      const key = `${platform}:${dataset}`;
      const collect = collectors[key];
      if (!collect) continue;
      const startedAt = Date.now();
      try {
        console.error(`[collect] ${key} start`);
        const platformState = await ensureOpenCliProfile(platform);
        if (!platformState || platformState.ok === false) {
          throw new Error(platformState && platformState.error || `profile not connected before ${key}`);
        }
        const result = await collect();
        summary.datasets.push(result);
        console.error(`[collect] ${key} ok ${result.durationMs}ms rows=${result.rows}`);
      } catch (err) {
        const message = err.message || String(err);
        const needsLogin = /needs login|login required|请先登录|立即登录|扫码登录|passport\.bilibili\.com\/login|opened wrong page.+\/login/i.test(message);
        summary.datasets.push({
          ok: needsLogin,
          skipped: needsLogin,
          skipReason: needsLogin ? 'needs_login' : '',
          platform,
          dataset,
          durationMs: Date.now() - startedAt,
          error: message
        });
        console.error(`[collect] ${key} ${needsLogin ? 'skipped' : 'failed'}: ${message}`);
      } finally {
        const closed = await closeActiveBrowserSessions();
        if (closed.length) {
          summary.lifecycle.sessionCloses.push({ after: key, results: closed });
          for (const item of closed) {
            console.error(`[lifecycle] close session ${item.session} ${item.ok ? 'ok' : 'failed'}`);
          }
        }
      }
    }
  }
  const launchedProfileDirectory = profileState && profileState.launched && profileState.launched.profileDirectory;
  const profileDirectoryToClose = launchedProfileDirectory || chromeProfileByOpenCli[requestedProfile] || chromeProfileByOpenCli[profile];
  if (profileDirectoryToClose && args.closeProfile === 'true') {
    summary.lifecycle.profileClose = await closeChromeProfileDirectory(profileDirectoryToClose, 'data collection finished');
    console.error(`[lifecycle] close profile ${profileDirectoryToClose} ${summary.lifecycle.profileClose.ok ? 'ok' : 'failed'}`);
  } else {
    summary.lifecycle.profileClose = {
      ok: true,
      skipped: true,
      reason: launchedProfileDirectory ? 'profile kept open by default; pass --closeProfile true to close it' : 'profile was already connected or not launched by this script'
    };
  }
  summary.finishedAt = new Date().toISOString();
  summary.ok = skipped || summary.datasets.every(item => item.ok);
  summary.summaryFile = path.join(outDir, `platform-data-summary-${artifactPrefix}-${stamp()}.json`);
  fs.writeFileSync(summary.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
