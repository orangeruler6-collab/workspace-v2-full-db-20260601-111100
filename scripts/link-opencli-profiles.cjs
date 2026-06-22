const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { publishAccountCatalog } = require('../server/lib/accountCatalog.cjs');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OPENCLI = process.env.OPENCLI_BIN || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'opencli.cmd');
const EXTENSION = process.env.OPENCLI_EXTENSION_DIR
  || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');
const OUT_FILE = path.join(ROOT, 'tmp', 'opencli-profile-link-report.json');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function splitList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise(resolve => {
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
      resolve({ code: -1, stdout, stderr: stderr + '\ntimeout', args });
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message, args });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, args });
    });
  });
}

async function runOpenCli(args, timeoutMs = 30000) {
  const result = await run('cmd.exe', ['/d', '/s', '/c', OPENCLI].concat(args), { timeoutMs });
  result.output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return result;
}

async function runPowerShell(script, timeoutMs = 30000) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs });
}

function parseProfiles(text) {
  let disconnected = false;
  return String(text || '').split(/\r?\n/).map(line => {
    if (/Disconnected saved profiles/i.test(line)) {
      disconnected = true;
      return null;
    }
    if (/Connected Browser Bridge profiles/i.test(line)) {
      disconnected = false;
      return null;
    }
    const match = line.match(/^\s*(\S+)\s+(.*)$/);
    if (!match) return null;
    const rest = match[2] || '';
    if (/Update available|Run:|No Browser Bridge/i.test(line)) return null;
    const alias = (rest.match(/alias[:\uFF1A]\s*([^\s]+)/i) || [])[1] || '';
    const connected = !disconnected && /connected/i.test(rest) && !/not connected|disconnected/i.test(rest);
    return {
      context_id: match[1],
      alias: alias || match[1],
      connected,
      raw: line.trim()
    };
  }).filter(Boolean);
}

async function listProfiles() {
  const result = await runOpenCli(['profile', 'list'], 20000);
  return parseProfiles(result.output);
}

async function closeProfile(profileDirectory, reason) {
  const profile = String(profileDirectory || '').replace(/'/g, "''");
  const extension = String(EXTENSION || '').replace(/'/g, "''");
  const script = `$profile='${profile}'; $extension='${extension}'; ` +
    'Get-CimInstance Win32_Process -Filter "name = \'chrome.exe\'" | ' +
    'Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($profile) -or $_.CommandLine.Contains($extension)) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }';
  const result = await runPowerShell(script, 20000);
  return { reason, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

async function launchProfile(profileDirectory) {
  const args = [
    '--new-window',
    `--profile-directory=${profileDirectory}`,
    `--load-extension=${EXTENSION}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function uniqueCatalogProfiles() {
  const rows = [];
  const seen = new Set();
  for (const account of publishAccountCatalog()) {
    for (const platform of account.platforms || []) {
      const alias = String(platform.profile_alias || '').trim();
      const dir = String(platform.chrome_profile_directory || '').trim();
      if (!alias || !dir || seen.has(alias)) continue;
      seen.add(alias);
      rows.push({
        account: account.name,
        groupName: account.groupName,
        alias,
        chromeProfileDirectory: dir,
        platforms: (account.platforms || []).filter(item => item.profile_alias === alias).map(item => item.id)
      });
    }
  }
  return rows;
}

async function linkOne(row) {
  await closeProfile(row.chromeProfileDirectory, 'before link');
  await wait(1200);
  const before = await listProfiles().catch(() => []);
  const beforeIds = new Set(before.map(item => String(item.context_id || '').trim()).filter(Boolean));
  await launchProfile(row.chromeProfileDirectory);
  const deadline = Date.now() + Number(argValue('--connectTimeoutMs', 45000));
  let profiles = [];
  let connected = null;
  while (Date.now() < deadline) {
    await wait(2500);
    profiles = await listProfiles().catch(() => []);
    connected = profiles.find(item => item.connected && (item.alias === row.alias || item.context_id === row.alias))
      || profiles.find(item => item.connected && item.context_id && !beforeIds.has(String(item.context_id).trim()))
      || profiles.find(item => item.connected);
    if (connected) break;
  }
  const result = {
    ok: Boolean(connected),
    account: row.account,
    groupName: row.groupName,
    alias: row.alias,
    chromeProfileDirectory: row.chromeProfileDirectory,
    platforms: row.platforms,
    contextId: connected && connected.context_id || '',
    connectedRaw: connected && connected.raw || '',
    error: connected ? '' : 'OpenCLI Browser Bridge not connected after launch'
  };
  if (connected && connected.context_id && connected.alias !== row.alias) {
    const renamed = await runOpenCli(['profile', 'rename', connected.context_id, row.alias], 20000);
    result.rename = {
      ok: renamed.code === 0,
      output: String(renamed.output || '').trim()
    };
  }
  await closeProfile(row.chromeProfileDirectory, 'after link');
  await wait(800);
  return result;
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  if (!fs.existsSync(path.join(EXTENSION, 'manifest.json'))) throw new Error(`OpenCLI extension folder not found: ${EXTENSION}`);
  if (!fs.existsSync(OPENCLI)) throw new Error(`opencli not found: ${OPENCLI}`);
  const wanted = new Set(splitList(argValue('--profiles', '')));
  const limit = Number(argValue('--limit', 0)) || 0;
  let rows = uniqueCatalogProfiles();
  if (wanted.size) rows = rows.filter(row => wanted.has(row.alias) || wanted.has(row.account) || wanted.has(row.chromeProfileDirectory));
  if (limit > 0) rows = rows.slice(0, limit);
  const report = {
    ok: true,
    startedAt: new Date().toISOString(),
    extension: EXTENSION,
    total: rows.length,
    results: []
  };
  for (const row of rows) {
    process.stdout.write(`[link] ${row.account} ${row.alias} ${row.chromeProfileDirectory}\n`);
    const result = await linkOne(row);
    report.results.push(result);
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`  -> ${result.ok ? 'ok ' + result.contextId : 'fail ' + result.error}\n`);
  }
  report.finishedAt = new Date().toISOString();
  report.ok = report.results.every(item => item.ok);
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: report.ok,
    total: report.total,
    linked: report.results.filter(item => item.ok).length,
    failed: report.results.filter(item => !item.ok).map(item => ({ account: item.account, alias: item.alias, error: item.error })),
    reportFile: OUT_FILE
  }, null, 2));
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
