const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromeProfileDirectoryMap, dashboardProfileMeta } = require('../server/lib/accountCatalog.cjs');

const ROOT = path.resolve(__dirname, '..');
const collectScript = path.join(__dirname, 'collect-platform-data.cjs');
const updatePlatformStatusScript = path.join(__dirname, 'update-account-platform-status.cjs');
const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(ROOT, args.outDir || path.join('data', 'data-export-tests'));
const targets = parseTargets(args.targets || '');
const profiles = unique(targets.length ? targets.map(target => target.profile) : splitArg(args.profiles || args.profile || ''));
const platforms = args.platforms || 'douyin,kuaishou,bilibili';
const datasets = args.datasets || 'fans,works';
const sessionPrefix = args.sessionPrefix || `account-data-batch-${Date.now()}`;
const profileMode = args.profileMode || 'direct';
const closeProfile = args.closeProfile === undefined ? 'true' : args.closeProfile;
const singleProfileBindEnabled = args.singleProfileBind === undefined
  ? process.env.ACCOUNT_DATA_SINGLE_PROFILE_BIND !== 'false'
  : args.singleProfileBind === 'true';
const singleProfilePlatforms = new Set(['douyin', 'kuaishou', 'bilibili']);
const childTimeoutMs = Number(args.childTimeoutMs || process.env.ACCOUNT_DATA_CHILD_TIMEOUT_MS || 20 * 60 * 1000);
const requestedBatchSize = Math.max(1, Number(args.batchSize || process.env.ACCOUNT_DATA_BATCH_SIZE || 1) || 1);
const batchSize = 1;
const batchPauseMs = Math.max(0, Number(args.batchPauseMs || process.env.ACCOUNT_DATA_BATCH_PAUSE_MS || 5000) || 0);
const cleanupBetweenBatches = args.cleanupBetweenBatches !== 'false' && process.env.ACCOUNT_DATA_CLEANUP_BETWEEN_BATCHES !== 'false';
const skipDisconnected = args.skipDisconnected !== 'false' && process.env.ACCOUNT_DATA_SKIP_DISCONNECTED !== 'false';
const abortAfterInfrastructureFailures = Math.max(0, Number(args.abortAfterInfrastructureFailures || process.env.ACCOUNT_DATA_ABORT_AFTER_INFRA_FAILURES || 5) || 0);
const profileCloseVerifyTimeoutMs = Math.max(1000, Number(args.profileCloseVerifyTimeoutMs || process.env.ACCOUNT_DATA_PROFILE_CLOSE_VERIFY_TIMEOUT_MS || 12000) || 12000);
const profileCloseVerifyIntervalMs = Math.max(300, Number(args.profileCloseVerifyIntervalMs || process.env.ACCOUNT_DATA_PROFILE_CLOSE_VERIFY_INTERVAL_MS || 1000) || 1000);
const childNodeOptions = mergeNodeOptions(process.env.NODE_OPTIONS || '', process.env.ACCOUNT_DATA_CHILD_NODE_OPTIONS || '--max-old-space-size=4096');
const forceAllPlatforms = args.forceAllPlatforms === 'true' || process.env.ACCOUNT_DATA_FORCE_ALL_PLATFORMS === '1';
const loginReportFile = args.loginReport ? path.resolve(ROOT, args.loginReport) : '';
const onlyLoggedInPlatforms = args.onlyLoggedInPlatforms === 'true' || process.env.ACCOUNT_DATA_ONLY_LOGGED_IN_PLATFORMS === '1';
const stateFile = path.resolve(ROOT, args.stateFile || path.join('data', 'account-data-collect-state.json'));
const writeState = args.writeState !== 'false' && process.env.ACCOUNT_DATA_WRITE_STATE !== 'false';
const collectTrigger = String(args.trigger || 'cli');
const queueOffset = Math.max(0, Number(args.queueOffset || 0) || 0);
const queueTotal = Math.max(0, Number(args.queueTotal || 0) || 0);
const queueExplicit = args.queueExplicit === 'true';
const explicitUpdatePlatformStatus = args.updatePlatformStatus !== undefined || process.env.ACCOUNT_DATA_UPDATE_PLATFORM_STATUS !== undefined;
const updatePlatformStatusEnabled = explicitUpdatePlatformStatus
  ? args.updatePlatformStatus !== 'false' && process.env.ACCOUNT_DATA_UPDATE_PLATFORM_STATUS !== 'false'
  : profiles.length >= 10;
const profileMeta = dashboardProfileMeta();
const chromeProfiles = chromeProfileDirectoryMap();
const loginPlatformMap = buildLoginPlatformMap();

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

function unique(values) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    rows.push(value);
  }
  return rows;
}

function parseTargets(value) {
  return splitArg(value).map(item => {
    const index = item.lastIndexOf(':');
    if (index <= 0 || index >= item.length - 1) return null;
    return {
      profile: item.slice(0, index).trim(),
      platform: item.slice(index + 1).trim()
    };
  }).filter(item => item && item.profile && item.platform);
}

function uniqueTargets(values) {
  const seen = new Set();
  const rows = [];
  for (const value of values || []) {
    const key = [value.profile, value.platform].join(':');
    if (!value.profile || !value.platform || seen.has(key)) continue;
    seen.add(key);
    rows.push(value);
  }
  return rows;
}

function platformsForProfile(profile, platformOverride) {
  const requested = splitArg(platforms);
  if (platformOverride) {
    return requested.includes(platformOverride) ? platformOverride : '';
  }
  const allowedByLogin = onlyLoggedInPlatforms ? loginPlatformMap.get(String(profile || '').trim()) : null;
  if (allowedByLogin) {
    const filtered = requested.filter(platform => allowedByLogin.has(platform));
    return filtered.join(',');
  }
  if (onlyLoggedInPlatforms) return '';
  if (forceAllPlatforms) return requested.join(',');
  const meta = profileMeta[String(profile || '').trim()] || {};
  const allowed = new Set(Array.isArray(meta.platformIds) ? meta.platformIds : []);
  if (!allowed.size) return requested.join(',');
  const filtered = requested.filter(platform => allowed.has(platform));
  return (filtered.length ? filtered : requested).join(',');
}

function buildLoginPlatformMap() {
  const map = new Map();
  if (!loginReportFile) return map;
  const report = safeReadJson(loginReportFile);
  for (const item of report && Array.isArray(report.results) ? report.results : []) {
    const aliases = [item.alias, item.account, item.accountId].filter(Boolean).map(value => String(value).trim());
    const okPlatforms = new Set((item.platforms || [])
      .filter(platform => platform && platform.status === 'logged_in')
      .map(platform => platform.platform)
      .filter(Boolean));
    if (!okPlatforms.size) continue;
    for (const alias of aliases) map.set(alias, okPlatforms);
  }
  return map;
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function safeWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function mergeNodeOptions(current, addition) {
  const parts = String(current || '').split(/\s+/).filter(Boolean);
  for (const part of String(addition || '').split(/\s+/).filter(Boolean)) {
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.join(' ');
}

function infrastructureFailureText(value) {
  return /Fatal process out of memory|heap out of memory|out of memory|chrome-error:\/\/chromewebdata|Browser connection dropped|Browser Bridge session may have restarted|Target tab .*not part of the current browser session|command_result_unknown|Target closed|Page crashed|RESULT_CODE_KILLED|WebSocket.*closed|Session closed|browser has been closed/i.test(String(value || ''));
}

function isInfrastructureFailure(result) {
  if (!result || result.ok || result.skipped) return false;
  return infrastructureFailureText([
    result.error,
    result.stderrTail,
    result.stdoutTail
  ].filter(Boolean).join('\n'));
}

function collectSourceSnapshot() {
  const sourceDir = outDir;
  const entries = fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : [];
  const platformSummaries = [];
  const batchSummaries = [];
  for (const name of entries) {
    const full = path.join(sourceDir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (!stat.isFile()) continue;
    if (/^platform-data-summary-.+\.json$/i.test(name)) platformSummaries.push({ full, mtimeMs: stat.mtimeMs, name });
    if (/^account-data-batch-summary-.+\.json$/i.test(name)) batchSummaries.push({ full, mtimeMs: stat.mtimeMs, name });
  }
  platformSummaries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  batchSummaries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const digest = [
    platformSummaries.length,
    platformSummaries.at(-1)?.mtimeMs || 0,
    platformSummaries.reduce((sum, item) => sum + Math.floor(item.mtimeMs), 0),
    platformSummaries.at(-1)?.name || '',
    batchSummaries.length,
    batchSummaries.at(-1)?.mtimeMs || 0,
    batchSummaries.reduce((sum, item) => sum + Math.floor(item.mtimeMs), 0),
    batchSummaries.at(-1)?.name || ''
  ].join('|');
  return { platformSummaries, batchSummaries, digest };
}

function refreshCollectIndex() {
  const snapshot = collectSourceSnapshot();
  const existing = safeReadJson(path.join(ROOT, 'data', 'account-data-collect-index.json'));
  if (existing && existing.version >= 2 && existing.sourceStats && existing.sourceStats.digest === snapshot.digest) return existing;
  const latestDatasets = {};
  const datasetHistory = [];
  const runs = [];
  for (const item of snapshot.platformSummaries) {
    const summary = safeReadJson(item.full);
    if (!summary) continue;
    const profile = String(summary.profile || summary.requestedProfile || '').trim() || '';
    const run = {
      type: 'platform',
      profile,
      ok: summary.ok !== false,
      skipped: Boolean(summary.skipped),
      skipReason: summary.skipReason || '',
      startedAt: summary.startedAt || '',
      finishedAt: summary.finishedAt || summary.startedAt || '',
      summaryFile: item.full,
      datasets: []
    };
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
      latestDatasets[[profile, row.platform, row.dataset].join(':')] = row;
    }
    runs.push(run);
  }
  for (const item of snapshot.batchSummaries) {
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
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceDir: outDir,
    sourceStats: { digest: snapshot.digest, platform: null, batch: null },
    latestDatasets,
    datasetHistory,
    runs
  };
  safeWriteJson(path.join(ROOT, 'data', 'account-data-collect-index.json'), index);
  return index;
}

async function updateAccountPlatformStatus() {
  if (!fs.existsSync(updatePlatformStatusScript)) return null;
  const result = await run(process.execPath, [
    updatePlatformStatusScript,
    '--outDir', outDir,
    '--sessionPrefix', sessionPrefix,
    '--platforms', platforms
  ], { timeoutMs: 120000 });
  if (result.code !== 0) {
    console.error(`[platform-status] update failed: ${tailText(result.stderr || result.stdout, 1000)}`);
    return { ok: false, error: tailText(result.stderr || result.stdout, 1000) };
  }
  console.error('[platform-status] updated');
  return { ok: true, stdout: tailText(result.stdout, 1000) };
}

function latestSummaryAfter(startedMs, expectedArtifactPrefix) {
  if (!fs.existsSync(outDir)) return null;
  return fs.readdirSync(outDir)
    .filter(name => /^platform-data-summary-.+\.json$/i.test(name))
    .map(name => {
      const full = path.join(outDir, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) {}
      return { full, mtimeMs, summary: safeReadJson(full) };
    })
    .filter(item => item.mtimeMs >= startedMs - 1000)
    .filter(item => {
      if (!expectedArtifactPrefix) return true;
      const summary = item.summary || {};
      return String(summary.artifactPrefix || '').trim() === expectedArtifactPrefix
        || path.basename(item.full).includes(expectedArtifactPrefix);
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

function tailText(value, limit) {
  const text = String(value || '');
  return text.length > limit ? text.slice(text.length - limit) : text;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(command, argv, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
    }, options.timeoutMs || childTimeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + '\n' + (err.message || String(err)) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr });
    });
  });
}

function chunks(values, size) {
  const rows = [];
  for (let i = 0; i < values.length; i += size) rows.push(values.slice(i, i + size));
  return rows;
}

function profileDirectoryFor(profile) {
  const wanted = String(profile || '').trim();
  return chromeProfiles[wanted] || '';
}

function accountNameForProfile(profile) {
  const meta = profileMeta[String(profile || '').trim()] || {};
  return String(meta.account || meta.name || '').trim();
}

function safeNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function closeChromeProfileDirectories(directories, reason) {
  const uniqueDirs = unique((directories || []).filter(Boolean));
  if (!uniqueDirs.length) return [];
  const quotedDirs = uniqueDirs.map(dir => "'" + String(dir).replace(/'/g, "''") + "'").join(',');
  const script = [
    '$dirs=@(' + quotedDirs + ');',
    '$killed=@();',
    'foreach($dir in $dirs){',
    "$needle='--profile-directory=' + $dir;",
    "$needleQuoted='--profile-directory=\"' + $dir + '\"';",
    "for($i=0;$i -lt 3;$i++){",
    "$rows=Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $cmd=($_.CommandLine -replace '\"',''); $cmd -like \"*$needle*\" -or $_.CommandLine -like \"*$needleQuoted*\" };",
    'if(-not $rows){ break }',
    '$rows | ForEach-Object { $killed += $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };',
    'Start-Sleep -Milliseconds 800;',
    '}',
    '}',
    '$killed | Select-Object -Unique'
  ].join(' ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 60000 });
  return [{
    ok: result.code === 0,
    reason: reason || '',
    directories: uniqueDirs,
    killedPids: String(result.stdout || '').trim().split(/\s+/).filter(Boolean),
    stderr: String(result.stderr || '').trim()
  }];
}

async function listChromeProfilePids(directories) {
  const uniqueDirs = unique((directories || []).filter(Boolean));
  if (!uniqueDirs.length) return [];
  const quotedDirs = uniqueDirs.map(dir => "'" + String(dir).replace(/'/g, "''") + "'").join(',');
  const script = [
    '$dirs=@(' + quotedDirs + ');',
    '$rows=@();',
    'foreach($dir in $dirs){',
    "$needle='--profile-directory=' + $dir;",
    "$needleQuoted='--profile-directory=\"' + $dir + '\"';",
    "$matches=Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $cmd=($_.CommandLine -replace '\"',''); $cmd -like \"*$needle*\" -or $_.CommandLine -like \"*$needleQuoted*\" };",
    '$matches | ForEach-Object { $rows += [pscustomobject]@{ profileDirectory=$dir; pid=$_.ProcessId } };',
    '}',
    '$rows | ConvertTo-Json -Compress'
  ].join(' ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 30000 });
  const text = String(result.stdout || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return [];
  }
}

async function verifyChromeProfilesClosed(directories, reason) {
  const uniqueDirs = unique((directories || []).filter(Boolean));
  if (!uniqueDirs.length) return { ok: true, skipped: true, directories: [], remaining: [] };
  const started = Date.now();
  let cleanup = [];
  let remaining = await listChromeProfilePids(uniqueDirs);
  if (remaining.length) cleanup = await closeChromeProfileDirectories(uniqueDirs, reason || 'before next batch');
  while (remaining.length && Date.now() - started < profileCloseVerifyTimeoutMs) {
    await wait(profileCloseVerifyIntervalMs);
    remaining = await listChromeProfilePids(uniqueDirs);
    if (remaining.length) cleanup = await closeChromeProfileDirectories(uniqueDirs, reason || 'before next batch');
  }
  return {
    ok: remaining.length === 0,
    skipped: false,
    directories: uniqueDirs,
    cleanup,
    remaining
  };
}

async function closeAllChrome(reason) {
  if (process.env.ACCOUNT_DATA_FORCE_KILL_CHROME_AFTER_BATCH !== '1') return { ok: true, skipped: true, reason: reason || '' };
  const script = [
    `$rows=Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'";`,
    '$ids=@();',
    '$rows | ForEach-Object { $ids += $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };',
    '$ids | Select-Object -Unique'
  ].join(' ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 60000 });
  return {
    ok: result.code === 0,
    reason: reason || '',
    killedPids: String(result.stdout || '').trim().split(/\s+/).filter(Boolean),
    stderr: String(result.stderr || '').trim()
  };
}

async function collectOneProfile(profile, batchIndex, platformOverride) {
  const startedMs = Date.now();
  const profilePlatforms = platformsForProfile(profile, platformOverride);
  const accountName = accountNameForProfile(profile);
  if (!profilePlatforms) {
    console.error(`[batch] ${profile}${platformOverride ? ':' + platformOverride : ''} skipped no matching platforms`);
    return {
      ok: true,
      profile,
      accountName,
      batch: batchIndex + 1,
      skipped: true,
      skipReason: 'no_logged_in_platforms',
      exitCode: 0,
      summaryFile: '',
      platforms: platformOverride || '',
      error: '',
      stdoutTail: '',
      stderrTail: ''
    };
  }
  const safeProfile = profile.replace(/[^\w.-]+/g, '-');
  const safeAccount = safeNamePart(accountName);
  const safePlatform = String(platformOverride || profilePlatforms).replace(/[^\w.-]+/g, '-');
  const artifactPrefix = [sessionPrefix, safeProfile, safeAccount, safePlatform].filter(Boolean).join('-');
  const argv = [
    collectScript,
    '--profile', profile,
    '--profileMode', profileMode,
    '--platforms', profilePlatforms,
    '--datasets', datasets,
    '--outDir', outDir,
    '--sessionPrefix', artifactPrefix,
    '--artifactPrefix', artifactPrefix
  ];
  if (args.launchProfile !== undefined) argv.push('--launchProfile', args.launchProfile);
  const profilePlatformList = splitArg(profilePlatforms);
  if (singleProfileBindEnabled && profilePlatformList.length === 1 && singleProfilePlatforms.has(profilePlatformList[0])) {
    argv.push('--singleProfileBind', 'true');
  }
  argv.push('--closeProfile', closeProfile);
  if (args.profileConnectTimeoutMs !== undefined) argv.push('--profileConnectTimeoutMs', args.profileConnectTimeoutMs);
  forwardArg(argv, 'profileReadyPollMs');
  forwardArg(argv, 'profileRebindTimeoutMs');
  forwardArg(argv, 'browserOpenTimeoutMs');
  forwardArg(argv, 'browserEvalTimeoutMs');
  forwardArg(argv, 'browserClickTimeoutMs');
  forwardArg(argv, 'postOpenWaitMs');
  forwardArg(argv, 'downloadTimeoutMs');
  forwardArg(argv, 'skipDisconnected');
  forwardArg(argv, 'allowNewContextFallback');
  forwardArg(argv, 'reconnectOnDisconnect');
  console.error(`[batch] ${profile}${platformOverride ? ':' + platformOverride : ''} start`);
  const child = await run(process.execPath, argv, {
    timeoutMs: childTimeoutMs,
    env: Object.assign({}, process.env, childNodeOptions ? { NODE_OPTIONS: childNodeOptions } : {})
  });
  const latest = latestSummaryAfter(startedMs, artifactPrefix);
  const summary = latest ? latest.summary : null;
  const summaryFile = summary ? latest.full : '';
  const disconnectText = [
    summary?.profileState?.error,
    ...(summary?.datasets || []).filter(item => item && item.ok === false).map(item => item.error),
    child.stderr
  ].filter(Boolean).join('\n');
  const disconnected = /not connected|profile not connected|Browser profile/i.test(disconnectText);
  const skipped = Boolean(skipDisconnected && disconnected);
  const ok = skipped || (child.code === 0 && Boolean(summary && summary.ok !== false));
  const result = {
    ok,
    profile,
    accountName,
    target: platformOverride ? `${profile}:${platformOverride}` : '',
    batch: batchIndex + 1,
    skipped,
    skipReason: skipped ? 'profile_not_connected' : '',
    exitCode: child.code,
    summaryFile,
    platforms: profilePlatforms,
    error: ok ? '' : (summary?.datasets || []).filter(item => item && item.ok === false).map(item => item.error).filter(Boolean).join('; ') || tailText(child.stderr, 1000),
    stdoutTail: tailText(child.stdout, 1000),
    stderrTail: tailText(child.stderr, 1000)
  };
  console.error(`[batch] ${profile}${platformOverride ? ':' + platformOverride : ''} ${skipped ? 'skipped' : ok ? 'ok' : 'failed'} code=${child.code}`);
  return result;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!profiles.length) throw new Error('missing --profiles');
  const startedAt = new Date().toISOString();
  const results = [];
  const batchResults = [];
  let aborted = false;
  let abortReason = '';
  let consecutiveInfrastructureFailureBatches = 0;
  const workItems = uniqueTargets(targets).length
    ? uniqueTargets(targets)
    : profiles.map(profile => ({ profile, platform: '' }));
  const profileBatches = chunks(workItems, batchSize);
  let previousProfileDirectories = [];
  function persistProgress(extra = {}) {
    if (!writeState) return;
    const completedTargets = results.map(item => item.target || item.profile).filter(Boolean);
    const nextOffset = queueTotal ? ((queueOffset + completedTargets.length) % queueTotal) : 0;
    const current = safeReadJson(stateFile) || {};
    const patch = {
      ok: true,
      running: true,
      trigger: current.trigger || collectTrigger,
      collectorPid: process.pid,
      completedTargets,
      skippedProfiles: unique(results.filter(item => item.skipped).map(item => item.profile)),
      batchProgress: {
        completed: completedTargets.length,
        total: workItems.length,
        currentTarget: extra.currentTarget || '',
        lastCompletedTarget: completedTargets.at(-1) || '',
        checkpointAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    };
    if (!queueExplicit && queueTotal) patch.nextCollectTargetOffset = nextOffset;
    safeWriteJson(stateFile, Object.assign({}, current, patch));
  }
  persistProgress();
  for (let batchIndex = 0; batchIndex < profileBatches.length; batchIndex += 1) {
    const batch = profileBatches[batchIndex];
    const batchStartedAt = new Date().toISOString();
    const preflight = cleanupBetweenBatches
      ? await verifyChromeProfilesClosed(previousProfileDirectories, `before batch ${batchIndex + 1}`)
      : { ok: true, skipped: true };
    if (!preflight.ok) {
      aborted = true;
      abortReason = `上一个浏览器 Profile 未关闭干净，已停止继续打开新 Profile`;
      batchResults.push({
        index: batchIndex + 1,
        profiles: unique(batch.map(item => item.profile)),
        targets: batch.map(item => item.platform ? `${item.profile}:${item.platform}` : item.profile),
        startedAt: batchStartedAt,
        finishedAt: new Date().toISOString(),
        preflight,
        cleanup: [],
        hardCleanup: { ok: true, skipped: true }
      });
      console.error(`[batch] aborted: ${abortReason}`);
      break;
    }
    const batchTarget = batch.map(item => item.platform ? `${item.profile}:${item.platform}` : item.profile).join(',');
    persistProgress({ currentTarget: batchTarget });
    console.error(`[batch] group ${batchIndex + 1}/${profileBatches.length} start targets=${batchTarget}`);
    const settled = [];
    for (const item of batch) {
      settled.push(await collectOneProfile(item.profile, batchIndex, item.platform));
    }
    results.push(...settled);
    const activeFailures = settled.filter(item => !item.ok && !item.skipped);
    const infrastructureOnly = activeFailures.length > 0 && activeFailures.every(isInfrastructureFailure);
    consecutiveInfrastructureFailureBatches = infrastructureOnly ? consecutiveInfrastructureFailureBatches + 1 : 0;
    const cleanup = cleanupBetweenBatches
      ? await closeChromeProfileDirectories(batch.map(item => profileDirectoryFor(item.profile)), `after batch ${batchIndex + 1}`)
      : [];
    const postflight = cleanupBetweenBatches
      ? await verifyChromeProfilesClosed(batch.map(item => profileDirectoryFor(item.profile)), `after batch ${batchIndex + 1} verify`)
      : { ok: true, skipped: true };
    const hardCleanup = cleanupBetweenBatches
      ? await closeAllChrome(`after batch ${batchIndex + 1}`)
      : { ok: true, skipped: true };
    previousProfileDirectories = batch.map(item => profileDirectoryFor(item.profile)).filter(Boolean);
    batchResults.push({
      index: batchIndex + 1,
      profiles: unique(batch.map(item => item.profile)),
      targets: batch.map(item => item.platform ? `${item.profile}:${item.platform}` : item.profile),
      startedAt: batchStartedAt,
      finishedAt: new Date().toISOString(),
      preflight,
      cleanup,
      postflight,
      hardCleanup
    });
    console.error(`[batch] group ${batchIndex + 1}/${profileBatches.length} done`);
    persistProgress();
    if (abortAfterInfrastructureFailures && consecutiveInfrastructureFailureBatches >= abortAfterInfrastructureFailures) {
      aborted = true;
      abortReason = `连续 ${consecutiveInfrastructureFailureBatches} 批浏览器/opencli 基础设施失败，已提前止损`;
      console.error(`[batch] aborted: ${abortReason}`);
      break;
    }
    if (batchPauseMs && batchIndex < profileBatches.length - 1) await wait(batchPauseMs);
  }
  const summary = {
    ok: !aborted && results.every(item => item.ok || item.skipped),
    aborted,
    abortReason,
    startedAt,
    finishedAt: new Date().toISOString(),
    profiles,
    targets: workItems.map(item => item.platform ? `${item.profile}:${item.platform}` : item.profile),
    batchSize,
    requestedBatchSize,
    executionMode: 'serial',
    cleanupBetweenBatches,
    skipDisconnected,
    abortAfterInfrastructureFailures,
    childNodeOptions,
    platforms,
    datasets,
    profileMode,
    closeProfile,
    forceAllPlatforms,
    loginReportFile,
    onlyLoggedInPlatforms,
    results,
    batches: batchResults
  };
  summary.summaryFile = path.join(outDir, `account-data-batch-summary-${stamp()}.json`);
  fs.writeFileSync(summary.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
  if (writeState) {
    const now = new Date().toISOString();
    const currentState = safeReadJson(stateFile) || {};
    const completedTargets = results.map(item => item.target || item.profile).filter(Boolean);
    const nextOffset = queueTotal ? ((queueOffset + completedTargets.length) % queueTotal) : 0;
    const nextState = Object.assign({}, currentState, {
      ok: summary.ok,
      running: false,
      trigger: currentState.trigger || collectTrigger,
      collectorPid: 0,
      startedAt,
      finishedAt: now,
      lastRun: now,
      lastSummaryFile: summary.summaryFile,
      profiles,
      targets: workItems.map(item => item.platform ? `${item.profile}:${item.platform}` : item.profile),
      profileQueue: currentState.profileQueue || { explicit: queueExplicit, unit: targets.length ? 'account_platform' : 'profile', total: queueTotal || workItems.length, offset: queueOffset, nextOffset, max: workItems.length },
      platforms,
      datasets,
      batchSize,
      requestedBatchSize,
      executionMode: 'serial',
      cleanupBetweenBatches,
      skipDisconnected,
      skippedProfiles: results.filter(item => item.skipped).map(item => item.profile),
      completedTargets,
      batchProgress: {
        completed: completedTargets.length,
        total: workItems.length,
        currentTarget: '',
        lastCompletedTarget: completedTargets.at(-1) || '',
        checkpointAt: now
      },
      error: summary.ok ? '' : 'batch collection failed',
      failures: results.filter(item => !item.ok && !item.skipped).map(item => ({
        profile: item.profile,
        platforms: item.platforms,
        error: item.error || 'collection failed',
        summaryFile: item.summaryFile || ''
      })),
      stdoutTail: '',
      stderrTail: '',
      exitCode: summary.ok ? 0 : 1,
      profile: profiles[0] || '',
      command: process.argv.slice(),
      updatedAt: now
    });
    if (!queueExplicit && queueTotal) nextState.nextCollectTargetOffset = nextOffset;
    safeWriteJson(stateFile, nextState);
  }
  console.error('[index] skipped local simplified index refresh; dashboard service will rebuild quality index');
  if (updatePlatformStatusEnabled) {
    try {
      summary.platformStatus = await updateAccountPlatformStatus();
    } catch (err) {
      summary.platformStatus = { ok: false, error: err && err.message ? err.message : String(err || 'platform status update failed') };
      console.error(`[platform-status] update failed: ${summary.platformStatus.error}`);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

function forwardArg(argv, key) {
  const envKey = 'ACCOUNT_DATA_' + key.replace(/[A-Z]/g, letter => '_' + letter).toUpperCase();
  const value = args[key] !== undefined ? args[key] : process.env[envKey];
  if (value !== undefined && value !== '') argv.push('--' + key, String(value));
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
