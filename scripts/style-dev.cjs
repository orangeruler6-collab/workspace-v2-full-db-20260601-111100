#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const styleRoot = path.join(root, 'apps', 'account-style-library');
const nextBin = path.join(styleRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const logPath = path.join(root, 'codex-style.log');
const errPath = path.join(root, 'codex-style.err.log');
const pidPath = path.join(root, 'codex-style.pid');
const nextPidPath = path.join(root, 'codex-style-next.pid');
const healthUrl = new URL(process.env.STYLE_DEV_HEALTH_URL || 'http://127.0.0.1:3100/style-workbench/api/health');
const healthIntervalMs = Number(process.env.STYLE_DEV_HEALTH_INTERVAL_MS || 30000);
const healthTimeoutMs = Number(process.env.STYLE_DEV_HEALTH_TIMEOUT_MS || 15000);
const healthMaxFailures = Number(process.env.STYLE_DEV_HEALTH_MAX_FAILURES || 4);
const startupGraceMs = Number(process.env.STYLE_DEV_STARTUP_GRACE_MS || 90000);
const restartBaseDelayMs = Number(process.env.STYLE_DEV_RESTART_BASE_DELAY_MS || 1000);
const restartMaxDelayMs = Number(process.env.STYLE_DEV_RESTART_MAX_DELAY_MS || 30000);
const stableResetMs = Number(process.env.STYLE_DEV_STABLE_RESET_MS || 10 * 60 * 1000);

let child = null;
let childStartedAt = 0;
let restartCount = 0;
let consecutiveHealthFailures = 0;
let restarting = false;
let shuttingDown = false;
let healthTimer = null;
let restartTimer = null;

function appendLog(filePath, message) {
  fs.appendFileSync(filePath, message);
}

function logInfo(message) {
  const line = `[style-dev] ${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  appendLog(logPath, line);
}

function logError(message) {
  const line = `[style-dev] ${new Date().toISOString()} ${message}\n`;
  process.stderr.write(line);
  appendLog(errPath, line);
}

function loadDotEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key || env[key]) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function cleanEnv() {
  const env = Object.assign({}, process.env);
  loadDotEnvFile(path.join(root, '.env'), env);
  env.STYLE_LIBRARY_DIR = env.STYLE_LIBRARY_DIR || path.join(root, 'data', 'style-library');
  env.USAGI_VECTOR_DB = env.USAGI_VECTOR_DB || path.join(root, 'data', 'vector_store.db');
  if (!env.NODE_OPTIONS || env.NODE_OPTIONS.indexOf('--max-old-space-size') === -1) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, '--max-old-space-size=4096'].filter(Boolean).join(' ');
  }
  if (process.platform === 'win32') {
    if (env.Path && !env.PATH) env.PATH = env.Path;
    if (env.Path) delete env.Path;
    env.PATH = [
      path.dirname(process.execPath),
      path.join(process.env.APPDATA || '', 'npm'),
      env.PATH || ''
    ].filter(Boolean).join(';');
  }
  return env;
}

function removeFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {}
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

function scheduleStart(reason) {
  if (shuttingDown || restartTimer) return;
  const delay = Math.min(restartMaxDelayMs, restartBaseDelayMs * Math.max(1, restartCount));
  logInfo(`restarting next in ${delay}ms (${reason})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startNext(reason);
  }, delay);
}

async function startNext(reason) {
  if (shuttingDown) return;
  try {
    await requestHealth();
    consecutiveHealthFailures = 0;
    restarting = false;
    logInfo(`next already healthy on ${healthUrl.origin}; skip start (${reason})`);
    return;
  } catch {}

  restartCount += 1;
  consecutiveHealthFailures = 0;
  restarting = false;
  childStartedAt = Date.now();

  logInfo(`starting next dev on ${healthUrl.origin} (${reason})`);
  child = spawn(process.execPath, [nextBin, 'dev', '-p', '3100', '-H', '0.0.0.0'], {
    cwd: styleRoot,
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });

  fs.writeFileSync(pidPath, String(process.pid));
  fs.writeFileSync(nextPidPath, String(child.pid));

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    fs.appendFileSync(logPath, chunk);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    fs.appendFileSync(errPath, chunk);
  });

  child.on('error', (error) => {
    logError(`next failed to start: ${error.stack || error.message}`);
    child = null;
    removeFile(nextPidPath);
    scheduleStart('spawn error');
  });

  child.on('exit', (code, signal) => {
    const uptimeMs = Date.now() - childStartedAt;
    const reasonText = signal ? `signal=${signal}` : `code=${code}`;
    logError(`next exited ${reasonText} uptimeMs=${uptimeMs}`);
    child = null;
    removeFile(nextPidPath);
    if (shuttingDown) return;
    requestHealth()
      .then(() => {
        consecutiveHealthFailures = 0;
        logInfo(`next wrapper exited ${reasonText}, but server remains healthy; keeping existing server`);
      })
      .catch(() => {
        if (uptimeMs >= stableResetMs) restartCount = 1;
        scheduleStart(`exit ${reasonText}`);
      });
  });
}

function requestHealth() {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: healthUrl.hostname,
        port: healthUrl.port || 80,
        path: `${healthUrl.pathname}${healthUrl.search}`,
        method: 'GET',
        timeout: healthTimeoutMs
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
            resolve(response.statusCode);
            return;
          }
          reject(new Error(`status ${response.statusCode}`));
        });
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error(`timeout ${healthTimeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function checkHealth() {
  if (shuttingDown || restarting) return;
  if (!child) {
    try {
      await requestHealth();
      consecutiveHealthFailures = 0;
      return;
    } catch (error) {
      consecutiveHealthFailures += 1;
      logError(`health failed without tracked child ${consecutiveHealthFailures}/${healthMaxFailures}: ${error.message}`);
      if (consecutiveHealthFailures >= healthMaxFailures) scheduleStart('missing child unhealthy');
      return;
    }
  }
  const uptimeMs = Date.now() - childStartedAt;
  if (uptimeMs < startupGraceMs) return;
  try {
    await requestHealth();
    if (consecutiveHealthFailures) {
      logInfo(`health recovered after ${consecutiveHealthFailures} failure(s)`);
    }
    consecutiveHealthFailures = 0;
  } catch (error) {
    consecutiveHealthFailures += 1;
    logError(`health failed ${consecutiveHealthFailures}/${healthMaxFailures}: ${error.message}`);
    if (consecutiveHealthFailures < healthMaxFailures || !child) return;
    restarting = true;
    const pid = child.pid;
    logError(`health failed repeatedly; restarting next pid=${pid}`);
    killProcessTree(pid);
    setTimeout(() => {
      if (!shuttingDown && restarting && child && child.pid === pid) {
        logError(`next pid=${pid} did not exit after health restart request; scheduling replacement`);
        child = null;
        removeFile(nextPidPath);
        scheduleStart('health timeout');
      }
    }, 5000).unref();
  }
}

function shutdown() {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (healthTimer) clearInterval(healthTimer);
  if (child) killProcessTree(child.pid);
  removeFile(pidPath);
  removeFile(nextPidPath);
  setTimeout(() => process.exit(0), 250).unref();
}

logInfo('supervisor starting');
fs.writeFileSync(pidPath, String(process.pid));
startNext('initial');
healthTimer = setInterval(checkHealth, healthIntervalMs);
healthTimer.unref();

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
