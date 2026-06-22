const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT = {
  label: 'fanshiqii',
  opencliProfile: 'dvabrcmr',
  chromeProfileDirectory: 'Profile 4',
  url: 'https://creator.douyin.com/creator-micro/data-center/content'
};

const TEXT = {
  list: '\u6295\u7a3f\u5217\u8868',
  export: '\u5bfc\u51fa\u6570\u636e',
  refresh: '\u5237\u65b0\u6570\u636e'
};

const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OPENCLI = process.env.OPENCLI_BIN || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'npm', 'opencli.cmd');
const EXTENSION = process.env.OPENCLI_EXTENSION_DIR || 'C:\\Users\\Administrator\\Documents\\Codex\\opencli-extension-loadable';
const DOWNLOADS = path.join(process.env.USERPROFILE || '', 'Downloads');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      windowsHide: options.windowsHide !== false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      reject(new Error(`timeout: ${command} ${args.join(' ')}`));
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started, command, args });
    });
  });
}

async function runOpenCli(args, timeoutMs = 30000) {
  if (!fs.existsSync(OPENCLI)) throw new Error(`opencli not found: ${OPENCLI}`);
  const result = await run('cmd.exe', ['/d', '/s', '/c', OPENCLI].concat(args), { timeoutMs });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return Object.assign(result, { output });
}

async function runPowerShell(script, timeoutMs = 30000) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs });
}

async function closeChromeProfile(reason) {
  const profile = ACCOUNT.chromeProfileDirectory.replace(/'/g, "''");
  const extension = EXTENSION.replace(/'/g, "''");
  const script = `$profile='${profile}'; $extension='${extension}'; ` +
    'Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | ' +
    'Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($profile) -or $_.CommandLine.Contains($extension)) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }';
  const result = await runPowerShell(script, 20000).catch(err => ({ stdout: '', stderr: err.message, code: -1 }));
  return { reason, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

async function launchChrome() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  if (!fs.existsSync(path.join(EXTENSION, 'manifest.json'))) {
    throw new Error(`OpenCLI extension folder not found: ${EXTENSION}`);
  }
  await closeChromeProfile('before launch');
  await wait(1500);
  const args = [
    '--new-window',
    `--profile-directory=${ACCOUNT.chromeProfileDirectory}`,
    `--load-extension=${EXTENSION}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

function hasConnectedProfile(text) {
  const line = String(text || '').split(/\r?\n/).find(item => item.includes(ACCOUNT.opencliProfile));
  return Boolean(line && /connected/i.test(line) && !/not connected/i.test(line));
}

async function waitForOpenCliProfile() {
  const deadline = Date.now() + 30000;
  let last = '';
  while (Date.now() < deadline) {
    const result = await runOpenCli(['profile', 'list'], 15000);
    last = result.output;
    if (hasConnectedProfile(last)) return last;
    await wait(1500);
  }
  throw new Error(`OpenCLI profile not connected: ${ACCOUNT.opencliProfile}\n${last}`);
}

function parsePageId(output) {
  const match = String(output || '').match(/"page"\s*:\s*"([^"]+)"/);
  return match ? match[1] : '';
}

function lines(text) {
  return String(text || '').split(/\r?\n/);
}

function refFromLine(line) {
  const match = String(line || '').match(/\[(\d+)\]/);
  return match ? match[1] : '';
}

function findRefNearText(snapshot, text, tags) {
  const rows = lines(snapshot);
  const wanted = Array.isArray(tags) ? tags : [];
  const index = rows.findIndex(line => line.includes(text));
  if (index < 0) return '';
  for (let i = index; i >= Math.max(0, index - 8); i -= 1) {
    if (!wanted.length || wanted.some(tag => rows[i].includes(`<${tag}`))) {
      const ref = refFromLine(rows[i]);
      if (ref) return ref;
    }
  }
  for (let i = index; i <= Math.min(rows.length - 1, index + 4); i += 1) {
    const ref = refFromLine(rows[i]);
    if (ref) return ref;
  }
  return '';
}

function findTopExportRef(snapshot) {
  const rows = lines(snapshot);
  const refreshIndex = rows.findIndex(line => line.includes(TEXT.refresh));
  if (refreshIndex >= 0) {
    let skippedRefreshButton = false;
    for (let i = refreshIndex; i >= Math.max(0, refreshIndex - 40); i -= 1) {
      if (!rows[i].includes('<button')) continue;
      const ref = refFromLine(rows[i]);
      if (!ref) continue;
      if (!skippedRefreshButton) {
        skippedRefreshButton = true;
        continue;
      }
      return ref;
    }
  }
  return findRefNearText(snapshot, TEXT.export, ['button']);
}

function latestDownloadedXlsx(startMs) {
  if (!fs.existsSync(DOWNLOADS)) return null;
  return fs.readdirSync(DOWNLOADS)
    .filter(name => /\.xlsx$/i.test(name))
    .map(name => {
      const full = path.join(DOWNLOADS, name);
      const stat = fs.statSync(full);
      return { full, stat };
    })
    .filter(item => item.stat.mtimeMs >= startMs && item.stat.size > 30000)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
}

async function waitForDownload(startMs) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const hit = latestDownloadedXlsx(startMs);
    if (hit) return hit;
    await wait(500);
  }
  throw new Error('download timeout: no new xlsx in 30s');
}

function copyAndParseExcel(downloaded) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const dest = path.join(ROOT, 'data', `fanshiqii-data-export-${stamp}.xlsx`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(downloaded.full, dest);
  const workbook = XLSX.readFile(dest);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return {
    copiedTo: dest,
    rows: rows.length,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    first: rows[0] || null
  };
}

async function main() {
  console.error(`[douyin-data-export-test] start ${ACCOUNT.label} / ${ACCOUNT.opencliProfile}`);
  const started = Date.now();
  const session = `fanshiqii-data-program-${started}`;
  const summary = {
    ok: false,
    account: ACCOUNT.label,
    profile: ACCOUNT.opencliProfile,
    chromeProfileDirectory: ACCOUNT.chromeProfileDirectory,
    session,
    steps: []
  };

  try {
    await launchChrome();
    console.error('[douyin-data-export-test] chrome launched');
    summary.steps.push({ step: 'launch_chrome', ok: true });

    await waitForOpenCliProfile();
    console.error('[douyin-data-export-test] opencli connected');
    summary.steps.push({ step: 'opencli_connected', ok: true });

    const openedAt = Date.now();
    const open = await runOpenCli(['--profile', ACCOUNT.opencliProfile, 'browser', session, 'open', ACCOUNT.url], 45000);
    const page = parsePageId(open.output);
    if (!page) throw new Error(`missing page id\n${open.output}`);
    summary.page = page;
    console.error(`[douyin-data-export-test] data page opened ${page}`);
    summary.steps.push({ step: 'open_data_center', ok: true, seconds: Number(((Date.now() - openedAt) / 1000).toFixed(2)) });

    await wait(5000);
    const state1 = await runOpenCli(['--profile', ACCOUNT.opencliProfile, 'browser', session, 'state', '--tab', page], 30000);
    const listRef = findRefNearText(state1.output, TEXT.list, ['label']);
    if (!listRef) throw new Error(`missing 投稿列表 ref\n${state1.output.slice(0, 2000)}`);
    summary.listRef = listRef;

    const listAt = Date.now();
    await runOpenCli(['--profile', ACCOUNT.opencliProfile, 'browser', session, 'click', listRef, '--tab', page], 20000);
    console.error(`[douyin-data-export-test] post list clicked ref=${listRef}`);
    await wait(800);
    const state2 = await runOpenCli(['--profile', ACCOUNT.opencliProfile, 'browser', session, 'state', '--tab', page], 30000);
    const exportRef = findTopExportRef(state2.output);
    if (!exportRef) throw new Error(`missing top export ref\n${state2.output.slice(0, 2500)}`);
    summary.exportRef = exportRef;
    summary.steps.push({ step: 'click_post_list', ok: true, waitedSeconds: 5, seconds: Number(((Date.now() - listAt) / 1000).toFixed(2)) });

    const exportAt = Date.now();
    await runOpenCli(['--profile', ACCOUNT.opencliProfile, 'browser', session, 'click', exportRef, '--tab', page], 20000);
    console.error(`[douyin-data-export-test] export clicked ref=${exportRef}`);
    const downloaded = await waitForDownload(exportAt);
    const parsed = copyAndParseExcel(downloaded);
    summary.steps.push({ step: 'export_download', ok: true, seconds: Number(((Date.now() - exportAt) / 1000).toFixed(2)) });

    summary.ok = true;
    summary.downloaded = downloaded.full;
    summary.downloadedSize = downloaded.stat.size;
    summary.copiedTo = parsed.copiedTo;
    summary.rows = parsed.rows;
    summary.columns = parsed.columns;
    summary.first = parsed.first;
    summary.totalSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
  } finally {
    summary.closedProfile = await closeChromeProfile('after data export test');
    console.error('[douyin-data-export-test] chrome profile close requested');
  }

  const summaryPath = path.join(ROOT, 'data', 'fanshiqii-data-export-last.json');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  summary.summaryPath = summaryPath;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch(async err => {
  const closedProfile = await closeChromeProfile('after failed data export test').catch(() => null);
  process.stderr.write(JSON.stringify({
    ok: false,
    error: err.message,
    closedProfile
  }, null, 2) + '\n');
  process.exit(1);
});
