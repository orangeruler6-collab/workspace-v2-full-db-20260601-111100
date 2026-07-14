#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const stateDir = path.join(root, 'logs');
const logPath = path.join(stateDir, 'service-watchdog.log');
const pidPath = path.join(root, 'service-watchdog.pid');
const statePath = path.join(root, 'service-watchdog.state.json');
const isWindows = process.platform === 'win32';
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const checkIntervalMs = Number(process.env.WATCHDOG_INTERVAL_MS || 60000);
const healthTimeoutMs = Number(process.env.WATCHDOG_HEALTH_TIMEOUT_MS || 90000);
const restartCooldownMs = Number(process.env.WATCHDOG_RESTART_COOLDOWN_MS || 120000);

fs.mkdirSync(stateDir, { recursive: true });

const services = [
  {
    key: 'front',
    name: 'Vue front 3000',
    port: 3000,
    healthUrl: 'http://127.0.0.1:3000/',
    cwd: root,
    command: process.execPath,
    args: [viteBin, '--host', '0.0.0.0', '--port', '3000'],
    env: {
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS || '', '--max-old-space-size=2048')
    }
  },
  {
    key: 'api',
    name: 'API 5555',
    port: 5555,
    healthUrl: 'http://127.0.0.1:5555/api/health',
    cwd: root,
    command: process.execPath,
    args: ['--max-old-space-size=4096', 'server/index.cjs'],
    preserveChildProcesses: true,
    env: {
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS || '', '--max-old-space-size=4096')
    }
  },
  {
    key: 'proxy80',
    name: 'Reverse proxy 80',
    port: 80,
    healthUrl: 'http://127.0.0.1/',
    cwd: root,
    command: process.execPath,
    args: ['scripts/reverse-proxy-80.cjs'],
    env: {
      REVERSE_PROXY_TARGET: 'http://127.0.0.1:3000',
      REVERSE_PROXY_PORT: '80',
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS || '', '--max-old-space-size=512')
    }
  }
];

const runtimePathDirs = [
  path.join(root, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin'),
  path.join(root, '.runtime', 'uv'),
  path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm')
].filter((dir) => fs.existsSync(dir));

function loadDotEnvFile(file, target, options = {}) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) return;
    const key = match[1];
    if (!options.override && target[key] !== undefined && target[key] !== '') return;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    target[key] = value;
  });
}

function appendNodeOption(current, option) {
  return current.includes(option) ? current : [current, option].filter(Boolean).join(' ');
}

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, extra) {
  const line = JSON.stringify({
    time: timestamp(),
    level,
    message,
    ...(extra || {})
  });
  fs.appendFileSync(logPath, line + '\n');
  if (process.env.WATCHDOG_FOREGROUND === '1') console.log(line);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { services: {} };
  }
}

function writeState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  loadDotEnvFile(path.join(root, '.env'), env, { override: true });
  env.STYLE_LIBRARY_DIR = env.STYLE_LIBRARY_DIR || path.join(root, 'data', 'style-library');
  env.USAGI_VECTOR_DB = env.USAGI_VECTOR_DB || path.join(root, 'data', 'vector_store.db');
  env.DOUYIN_DOWNLOADER_ROOT = env.DOUYIN_DOWNLOADER_ROOT || path.join(root, 'tools', 'douyin-downloader');
  env.BILIBILI_CLI_ROOT = env.BILIBILI_CLI_ROOT || path.join(root, 'tools', 'bilibili-cli');
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (isWindows && env.Path && !env.PATH) env.PATH = env.Path;
  if (isWindows && env.Path) delete env.Path;
  env.PATH = runtimePathDirs.concat(env.PATH || '').join(path.delimiter);
  return env;
}

function requestHealth(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        timeout: healthTimeoutMs
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve(res.statusCode);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timeout ${healthTimeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function spawnService(service) {
  const out = fs.openSync(path.join(root, `watchdog-${service.key}.out.log`), 'a');
  const err = fs.openSync(path.join(root, `watchdog-${service.key}.err.log`), 'a');
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: cleanEnv(service.env),
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    shell: false
  });
  child.unref();
  return child.pid;
}

function killPid(pid, killTree = true) {
  if (!pid) return;
  try {
    if (isWindows) {
      const args = ['/pid', String(pid)];
      if (killTree) args.push('/t');
      args.push('/f');
      spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {}
}

function findPortPids(port) {
  if (!isWindows) return [];
  try {
    const script = [
      `$items = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue`,
      '$items | Select-Object -ExpandProperty OwningProcess -Unique'
    ].join('; ');
    const result = require('child_process').spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', windowsHide: true }
    );
    return (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isWatchdogRunning(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkService(service, state) {
  const serviceState = state.services[service.key] || {};
  const now = Date.now();
  if (service.disabled) {
    state.services[service.key] = {
      ...serviceState,
      ok: false,
      status: 'paused',
      lastError: 'paused by maintenance',
      lastFailAt: serviceState.lastFailAt || timestamp()
    };
    return;
  }
  try {
    const status = await requestHealth(service.healthUrl);
    const portPids = findPortPids(service.port);
    state.services[service.key] = {
      ...serviceState,
      ok: true,
      status,
      pid: portPids.length === 1 ? portPids[0] : serviceState.pid,
      lastOkAt: timestamp(),
      lastError: null
    };
    return;
  } catch (error) {
    const sinceRestart = now - Number(serviceState.lastRestartMs || 0);
    state.services[service.key] = {
      ...serviceState,
      ok: false,
      lastError: error.message,
      lastFailAt: timestamp()
    };
    log('warn', `${service.name} health failed`, { service: service.key, error: error.message });
    if (sinceRestart < restartCooldownMs) return;
    const killTree = !service.preserveChildProcesses;
    if (serviceState.pid) killPid(serviceState.pid, killTree);
    for (const pid of findPortPids(service.port)) killPid(pid, killTree);
    try {
      const pid = spawnService(service);
      state.services[service.key] = {
        ...state.services[service.key],
        pid,
        lastRestartAt: timestamp(),
        lastRestartMs: now,
        restartCount: Number(serviceState.restartCount || 0) + 1
      };
      log('info', `${service.name} restarted`, { service: service.key, pid });
    } catch (spawnError) {
      state.services[service.key] = {
        ...state.services[service.key],
        lastRestartError: spawnError.message,
        lastRestartAt: timestamp(),
        lastRestartMs: now
      };
      log('error', `${service.name} restart failed`, {
        service: service.key,
        error: spawnError.stack || spawnError.message
      });
    }
  }
}

async function loopOnce() {
  const state = readState();
  state.updatedAt = timestamp();
  for (const service of services) {
    await checkService(service, state);
  }
  writeState(state);
}

async function runDaemon() {
  fs.writeFileSync(pidPath, String(process.pid));
  log('info', 'watchdog started', { pid: process.pid, intervalMs: checkIntervalMs });
  const run = async () => {
    try {
      await loopOnce();
    } catch (error) {
      log('error', 'watchdog loop failed', { error: error.stack || error.message });
    }
  };
  await run();
  setInterval(run, checkIntervalMs);
}

function startDetached() {
  const oldPid = Number(fs.existsSync(pidPath) ? fs.readFileSync(pidPath, 'utf8') : 0);
  if (isWatchdogRunning(oldPid)) {
    console.log(`watchdog already running pid=${oldPid}`);
    return;
  }
  const out = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [__filename, 'run'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: cleanEnv()
  });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid));
  console.log(`watchdog started pid=${child.pid}`);
}

function stopDaemon() {
  const pid = Number(fs.existsSync(pidPath) ? fs.readFileSync(pidPath, 'utf8') : 0);
  if (!pid) {
    console.log('watchdog is not running');
    return;
  }
  killPid(pid);
  try {
    fs.rmSync(pidPath, { force: true });
  } catch {}
  console.log(`watchdog stopped pid=${pid}`);
}

function printStatus() {
  const pid = Number(fs.existsSync(pidPath) ? fs.readFileSync(pidPath, 'utf8') : 0);
  const state = readState();
  console.log(JSON.stringify({
    running: isWatchdogRunning(pid),
    pid,
    logPath,
    state
  }, null, 2));
}

const command = process.argv[2] || 'status';
if (command === 'run') {
  runDaemon();
} else if (command === 'start') {
  startDetached();
} else if (command === 'stop') {
  stopDaemon();
} else if (command === 'status') {
  printStatus();
} else if (command === 'check') {
  loopOnce().then(printStatus);
} else {
  console.error('Usage: node scripts/service-watchdog.cjs <start|stop|status|check|run>');
  process.exit(2);
}
