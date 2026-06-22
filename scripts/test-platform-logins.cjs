const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { publishAccountCatalog, chromeProfileDirectoryMap, openCliBrowserProfileAliases } = require('../server/lib/accountCatalog.cjs');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OPENCLI_MAIN = process.env.OPENCLI_MAIN ||
  path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
const EXTENSION = process.env.OPENCLI_EXTENSION_DIR
  || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');
const OUT_FILE = path.resolve(ROOT, argValue('--outFile', path.join('tmp', 'platform-login-test-report.json')));
const CSV_FILE = path.resolve(ROOT, argValue('--csvFile', path.join('tmp', 'platform-login-test-report.csv')));

const args = parseArgs(process.argv.slice(2));
const platforms = splitList(args.platforms || 'douyin,kuaishou,bilibili,xiaohongshu');
const openWaitMs = Number(args.openWaitMs || 8000);
const connectTimeoutMs = Number(args.connectTimeoutMs || 60000);
const profileLimit = Number(args.limit || 0) || 0;
const aliases = openCliBrowserProfileAliases();
const chromeProfiles = chromeProfileDirectoryMap();

const platformMeta = {
  douyin: {
    label: '抖音',
    url: 'https://creator.douyin.com/creator-micro/content/upload',
    loginUrl: /login|passport|sso/i,
    loggedIn: ['发布作品', '创作服务平台', '数据中心', '内容管理', '投稿列表'],
    loggedOut: ['扫码登录', '登录后', '登录抖音', '手机号登录']
  },
  kuaishou: {
    label: '快手',
    url: 'https://cp.kuaishou.com/statistics/article',
    loginUrl: /login|passport/i,
    loggedIn: ['作品分析', '数据总览', '粉丝分析', '内容管理', '互动管理', '成长中心'],
    loggedOut: ['立即登录', '扫码登录', '登录', '手机号']
  },
  bilibili: {
    label: 'B站',
    url: 'https://member.bilibili.com/platform/data-up/video?tab=audience',
    loginUrl: /passport|login/i,
    loggedIn: ['创作中心', '稿件管理', '数据中心', '粉丝数据', '投稿'],
    loggedOut: ['登录', '扫码登录', '请先登录']
  },
  xiaohongshu: {
    label: '小红书',
    url: 'https://creator.xiaohongshu.com/publish/publish',
    loginUrl: /login|signin|passport/i,
    loggedIn: ['发布笔记', '创作服务', '数据中心', '笔记管理', '蒲公英'],
    loggedOut: ['登录', '扫码登录', '手机号登录', '验证码']
  }
};

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

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function splitList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(command, argv, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, argv, {
      cwd: options.cwd || ROOT,
      windowsHide: options.windowsHide !== false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      resolve({ code: -1, stdout, stderr: stderr + '\ntimeout', args: argv });
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message || String(err), args: argv });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr, args: argv });
    });
  });
}

async function opencli(profile, argv, timeoutMs = 30000) {
  if (!fs.existsSync(OPENCLI_MAIN)) {
    return { code: 1, stdout: '', stderr: `opencli main not found: ${OPENCLI_MAIN}` };
  }
  return run(process.execPath, [OPENCLI_MAIN, '--profile', profile].concat(argv), { timeoutMs });
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
    let rest = '';
    if (parts.length >= 2) {
      left = parts[0].trim();
      rest = parts.slice(1).join(' - ').trim();
    } else {
      const match = raw.match(/^\s*(\S+)\s+(.*)$/);
      if (!match) return null;
      left = match[1];
      rest = match[2] || '';
    }
    const leftMatch = left.match(/^(\S+)(?:\s+(.*))?$/);
    if (!leftMatch) return null;
    const alias = (rest.match(/alias[:\uFF1A]\s*([^\s]+)/i) || [])[1] || '';
    return {
      context_id: leftMatch[1],
      alias: leftMatch[2] || alias || leftMatch[1],
      connected: !disconnected && /connected/i.test(rest) && !/not connected|disconnected/i.test(rest),
      raw
    };
  }).filter(Boolean);
}

async function listProfiles() {
  const result = await run(process.execPath, [OPENCLI_MAIN, 'profile', 'list'], { timeoutMs: 20000 });
  return parseOpenCliProfiles(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function profileCandidates(alias) {
  const wanted = String(alias || '').trim();
  const candidates = new Set(wanted ? [wanted] : []);
  if (wanted && aliases[wanted]) candidates.add(String(aliases[wanted]).trim());
  Object.entries(aliases).forEach(([name, contextId]) => {
    if (String(contextId || '').trim() === wanted && name) candidates.add(String(name).trim());
  });
  return candidates;
}

function findConnectedProfile(profiles, alias) {
  const candidates = profileCandidates(alias);
  return (profiles || []).find(item => item && item.connected && (
    candidates.has(String(item.alias || '').trim()) || candidates.has(String(item.context_id || '').trim())
  )) || null;
}

async function closeProfile(profileDirectory, reason) {
  if (!profileDirectory) return { ok: true, skipped: true, reason };
  const escaped = String(profileDirectory).replace(/'/g, "''");
  const extension = String(EXTENSION || '').replace(/'/g, "''");
  const script = [
    "$dir='" + escaped + "';",
    "$extension='" + extension + "';",
    "$needle='--profile-directory=' + $dir;",
    "$needleQuoted='--profile-directory=\"' + $dir + '\"';",
    "$killed=@();",
    "for($i=0;$i -lt 3;$i++){",
    "$rows=Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $cmd=($_.CommandLine -replace '\"',''); $cmd -like \"*$needle*\" -or $_.CommandLine -like \"*$needleQuoted*\" -or $_.CommandLine -like \"*$extension*\" };",
    "if(-not $rows){ break }",
    "$rows | ForEach-Object { $killed += $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };",
    "Start-Sleep -Milliseconds 800;",
    "}",
    "$killed | Select-Object -Unique"
  ].join(' ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 30000 });
  return {
    ok: result.code === 0,
    reason,
    killedPids: String(result.stdout || '').trim().split(/\s+/).filter(Boolean),
    stderr: String(result.stderr || '').trim()
  };
}

async function launchProfile(profileDirectory, url) {
  const launchArgs = [
    '--new-window',
    `--profile-directory=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];
  if (fs.existsSync(path.join(EXTENSION, 'manifest.json'))) launchArgs.push(`--load-extension=${EXTENSION}`);
  launchArgs.push(url || 'about:blank');
  const child = spawn(CHROME, launchArgs, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { ok: true, args: launchArgs };
}

async function ensureProfile(row, platformId) {
  const before = await listProfiles().catch(() => []);
  const existing = findConnectedProfile(before, row.alias);
  if (existing) return { ok: true, profile: row.alias, contextId: existing.context_id, reused: true };
  const beforeIds = new Set(before.map(item => String(item.context_id || '').trim()).filter(Boolean));
  await closeProfile(row.chromeProfileDirectory, 'before profile login test');
  await wait(1000);
  await launchProfile(row.chromeProfileDirectory, (platformMeta[platformId] || {}).url || 'about:blank');
  const deadline = Date.now() + connectTimeoutMs;
  while (Date.now() < deadline) {
    await wait(2500);
    const profiles = await listProfiles().catch(() => []);
    const aliased = findConnectedProfile(profiles, row.alias);
    if (aliased) return { ok: true, profile: row.alias, contextId: aliased.context_id };
    const fresh = profiles.find(item => item.connected && item.context_id && !beforeIds.has(String(item.context_id).trim()));
    if (fresh) return { ok: true, profile: fresh.context_id || fresh.alias, contextId: fresh.context_id, detectedContextId: fresh.context_id };
  }
  return { ok: false, error: 'OpenCLI Browser Bridge not connected after launch' };
}

function extractJson(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').trim();
  try { return JSON.parse(clean); } catch (_) {}
  const start = clean.search(/[\[{]/);
  if (start >= 0) {
    for (let end = clean.length; end > start; end -= 1) {
      try { return JSON.parse(clean.slice(start, end).trim()); } catch (_) {}
    }
  }
  throw new Error('invalid json output: ' + clean.slice(0, 300));
}

async function closeSession(profile, session) {
  await opencli(profile, ['browser', session, 'close'], 20000).catch(() => null);
}

function classifyPlatform(platform, payload) {
  const meta = platformMeta[platform] || {};
  const url = String(payload.url || '');
  const title = String(payload.title || '');
  const text = String(payload.text || '');
  const haystack = `${url}\n${title}\n${text}`;
  const loggedOutHit = (meta.loggedOut || []).find(item => haystack.includes(item));
  const loggedInHit = (meta.loggedIn || []).find(item => haystack.includes(item));
  if (meta.loginUrl && meta.loginUrl.test(url)) {
    return { status: 'needs_login', ok: false, reason: `login_url:${url.slice(0, 120)}` };
  }
  if (loggedOutHit) {
    return { status: 'needs_login', ok: false, reason: `login_text:${loggedOutHit}` };
  }
  if (loggedInHit) {
    return { status: 'logged_in', ok: true, reason: `matched:${loggedInHit}` };
  }
  return { status: 'unknown', ok: false, reason: 'no_login_signal' };
}

async function testPlatform(row, platform) {
  const startedAt = new Date();
  const startedMs = startedAt.getTime();
  const timing = () => {
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedMs
    };
  };
  const meta = platformMeta[platform];
  if (!meta) return { platform, ok: false, status: 'unsupported', error: 'unsupported platform', ...timing() };
  const profileState = row.profileState || await ensureProfile(row, platform);
  if (!profileState.ok) {
    return { platform, label: meta.label, ok: false, status: 'profile_not_connected', profileState, error: profileState.error, ...timing() };
  }
  const session = `login-${platform}-${row.alias.replace(/[^\w.-]+/g, '-')}-${Date.now()}`;
  try {
    const opened = await opencli(profileState.profile, ['browser', session, 'open', meta.url], 90000);
    if (opened.code !== 0) throw new Error(String(opened.stderr || opened.stdout || 'open failed').trim());
    await wait(openWaitMs);
    const evalResult = await opencli(profileState.profile, [
      'browser', session, 'eval',
      `(()=>{const text=(document.body&&document.body.innerText||'').slice(0,6000);return {url:location.href,title:document.title,text,readyState:document.readyState};})()`
    ], 60000);
    if (evalResult.code !== 0) throw new Error(String(evalResult.stderr || evalResult.stdout || 'eval failed').trim());
    const payload = extractJson(`${evalResult.stdout || ''}\n${evalResult.stderr || ''}`);
    const judged = classifyPlatform(platform, payload);
    return {
      platform,
      label: meta.label,
      ok: judged.ok,
      status: judged.status,
      reason: judged.reason,
      url: payload.url,
      title: payload.title,
      readyState: payload.readyState,
      profileState,
      textSample: String(payload.text || '').slice(0, 500),
      ...timing()
    };
  } catch (err) {
    return {
      platform,
      label: meta.label,
      ok: false,
      status: 'open_failed',
      error: err.message || String(err),
      profileState,
      ...timing()
    };
  } finally {
    await closeSession(profileState.profile, session);
  }
}

function uniqueProfiles() {
  const wanted = new Set(splitList(args.profiles || ''));
  const rows = [];
  const seen = new Set();
  for (const account of publishAccountCatalog()) {
    for (const platform of account.platforms || []) {
      const alias = String(platform.profile_alias || '').trim();
      if (!alias || seen.has(alias)) continue;
      if (wanted.size && !wanted.has(alias) && !wanted.has(account.name)) continue;
      seen.add(alias);
      rows.push({
        account: account.name,
        accountId: account.id,
        groupName: account.groupName,
        alias,
        chromeProfileDirectory: chromeProfiles[alias] || platform.chrome_profile_directory || ''
      });
    }
  }
  return profileLimit > 0 ? rows.slice(0, profileLimit) : rows;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeReports(report) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  const rows = [['account', 'group', 'profile', 'chrome_profile', 'platform', 'status', 'ok', 'started_at', 'finished_at', 'duration_ms', 'reason', 'url', 'title', 'error']];
  for (const item of report.results) {
    for (const platform of item.platforms || []) {
      rows.push([
        item.account,
        item.groupName,
        item.alias,
        item.chromeProfileDirectory,
        platform.platform,
        platform.status,
        platform.ok ? '1' : '0',
        platform.startedAt || '',
        platform.finishedAt || '',
        platform.durationMs || '',
        platform.reason || '',
        platform.url || '',
        platform.title || '',
        platform.error || ''
      ]);
    }
  }
  fs.writeFileSync(CSV_FILE, rows.map(row => row.map(csvEscape).join(',')).join('\n'), 'utf8');
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  if (!fs.existsSync(OPENCLI_MAIN)) throw new Error(`opencli main not found: ${OPENCLI_MAIN}`);
  if (!fs.existsSync(path.join(EXTENSION, 'manifest.json'))) throw new Error(`OpenCLI extension not found: ${EXTENSION}`);
  const rows = uniqueProfiles();
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    platforms,
    totalProfiles: rows.length,
    outFile: OUT_FILE,
    csvFile: CSV_FILE,
    results: []
  };
  writeReports(report);
  for (const row of rows) {
    const item = Object.assign({}, row, { startedAt: new Date().toISOString(), platforms: [] });
    report.results.push(item);
    console.log(`[profile] ${row.account} ${row.alias}`);
    const initialProfileState = await ensureProfile(row, platforms[0]);
    item.profileState = initialProfileState;
    for (const platform of platforms) {
      console.log(`  [platform] ${platform} start`);
      const result = initialProfileState.ok
        ? await testPlatform(Object.assign({}, row, { profileState: initialProfileState }), platform)
        : {
          platform,
          label: (platformMeta[platform] || {}).label || platform,
          ok: false,
          status: 'profile_not_connected',
          profileState: initialProfileState,
          error: initialProfileState.error || 'OpenCLI Browser Bridge not connected after launch',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0
        };
      item.platforms.push(result);
      item.updatedAt = new Date().toISOString();
      writeReports(report);
      console.log(`  [platform] ${platform} ${result.status}`);
    }
    item.finishedAt = new Date().toISOString();
    await closeProfile(row.chromeProfileDirectory, 'after platform login test');
    writeReports(report);
  }
  report.finishedAt = new Date().toISOString();
  report.ok = report.results.every(item => item.platforms.every(platform => platform.ok));
  writeReports(report);
  console.log(JSON.stringify({
    ok: report.ok,
    totalProfiles: report.totalProfiles,
    totalPlatforms: report.results.reduce((sum, item) => sum + item.platforms.length, 0),
    loggedIn: report.results.reduce((sum, item) => sum + item.platforms.filter(platform => platform.status === 'logged_in').length, 0),
    needsLogin: report.results.reduce((sum, item) => sum + item.platforms.filter(platform => platform.status === 'needs_login').length, 0),
    unknown: report.results.reduce((sum, item) => sum + item.platforms.filter(platform => platform.status === 'unknown').length, 0),
    failed: report.results.reduce((sum, item) => sum + item.platforms.filter(platform => !platform.ok && platform.status !== 'needs_login' && platform.status !== 'unknown').length, 0),
    outFile: OUT_FILE,
    csvFile: CSV_FILE
  }, null, 2));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
