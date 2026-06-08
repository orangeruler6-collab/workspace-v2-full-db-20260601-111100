#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const styleRoot = path.join(root, 'apps', 'account-style-library');
const nextBin = path.join(styleRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const logPath = path.join(root, 'codex-style.log');
const errPath = path.join(root, 'codex-style.err.log');

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

fs.appendFileSync(logPath, `\n[style-dev] ${new Date().toISOString()} starting\n`);

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3100', '-H', '0.0.0.0'], {
  cwd: styleRoot,
  env: cleanEnv(),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

fs.writeFileSync(path.join(root, 'codex-style.pid'), String(process.pid));
fs.writeFileSync(path.join(root, 'codex-style-next.pid'), String(child.pid));

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  fs.appendFileSync(logPath, chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  fs.appendFileSync(errPath, chunk);
});

child.on('error', (error) => {
  const line = `[style-dev] failed: ${error.stack || error.message}\n`;
  process.stderr.write(line);
  fs.appendFileSync(errPath, line);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  const line = `[style-dev] next exited code=${code} signal=${signal}\n`;
  process.stderr.write(line);
  fs.appendFileSync(errPath, line);
  process.exit(code || 1);
});

function shutdown() {
  child.kill('SIGTERM');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
