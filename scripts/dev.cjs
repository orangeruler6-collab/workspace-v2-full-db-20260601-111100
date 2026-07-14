#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const viteBin = path.join(root, 'node_modules', '.bin', isWindows ? 'vite.cmd' : 'vite');
const contentBoardProxyBin = path.join(root, 'scripts', 'content-board-proxy.cjs');
const workspacePython = path.join(root, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const douyinPython = path.join(root, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const bilibiliPython = path.join(root, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const bilibiliBin = path.join(root, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts\\bili.exe' : 'bin/bili');
const npmGlobalBin = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm');
const larkCliBin = path.join(npmGlobalBin, isWindows ? 'lark-cli.cmd' : 'lark-cli');
const localPathDirs = [
  path.join(root, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin'),
  path.join(root, '.runtime', 'uv'),
  npmGlobalBin
].filter(function(dir) { return fs.existsSync(dir); });
const children = [];
let shuttingDown = false;

try {
  fs.writeFileSync(path.join(root, 'codex-dev.pid'), String(process.pid));
} catch (error) {
  console.warn('[dev] failed to write codex-dev.pid:', error.message);
}

function cleanEnv() {
  const env = Object.assign({}, process.env);
  env.STYLE_LIBRARY_DIR = env.STYLE_LIBRARY_DIR || path.join(root, 'data', 'style-library');
  env.USAGI_VECTOR_DB = env.USAGI_VECTOR_DB || path.join(root, 'data', 'vector_store.db');
  if (fs.existsSync(workspacePython)) {
    env.PYTHON = env.PYTHON || workspacePython;
    env.PYTHON_BIN = env.PYTHON_BIN || workspacePython;
    env.PYTHON_EXECUTABLE = env.PYTHON_EXECUTABLE || workspacePython;
  }
  if (fs.existsSync(douyinPython)) env.DOUYIN_DOWNLOADER_PYTHON = env.DOUYIN_DOWNLOADER_PYTHON || douyinPython;
  if (fs.existsSync(bilibiliPython)) env.BILIBILI_CLI_PYTHON = env.BILIBILI_CLI_PYTHON || bilibiliPython;
  if (fs.existsSync(bilibiliBin)) env.BILIBILI_CLI_BIN = env.BILIBILI_CLI_BIN || bilibiliBin;
  if (fs.existsSync(larkCliBin)) env.LARK_CLI_BIN = env.LARK_CLI_BIN || larkCliBin;
  env.DOUYIN_DOWNLOADER_ROOT = env.DOUYIN_DOWNLOADER_ROOT || path.join(root, 'tools', 'douyin-downloader');
  env.BILIBILI_CLI_ROOT = env.BILIBILI_CLI_ROOT || path.join(root, 'tools', 'bilibili-cli');
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (isWindows && env.Path && env.PATH && env.Path !== env.PATH) {
    delete env.Path;
  } else if (isWindows && env.Path && !env.PATH) {
    env.PATH = env.Path;
    delete env.Path;
  }
  env.PATH = localPathDirs.concat(env.PATH || '').join(path.delimiter);
  return env;
}

function run(name, command, args, cwd) {
  const useShell = isWindows && /\.cmd$/i.test(command);
  const child = spawn(command, args, {
    cwd: cwd || root,
    env: cleanEnv(),
    stdio: 'inherit',
    shell: useShell
  });

  children.push({ name, child });

  child.on('error', function(error) {
    if (shuttingDown) return;
    console.error('[dev] ' + name + ' failed to start:', error.message);
    shutdown(1);
  });

  child.on('exit', function(code, signal) {
    if (shuttingDown) return;
    const reason = signal ? 'signal ' + signal : 'code ' + code;
    console.error('[dev] ' + name + ' exited with ' + reason);
    shutdown(code || 1);
  });
}

function runOptional(name, command, args, cwd) {
  const useShell = isWindows && /\.cmd$/i.test(command);
  const child = spawn(command, args, {
    cwd: cwd || root,
    env: cleanEnv(),
    stdio: 'inherit',
    shell: useShell
  });

  children.push({ name, child });

  child.on('error', function(error) {
    if (shuttingDown) return;
    console.warn('[dev] optional ' + name + ' failed to start:', error.message);
  });

  child.on('exit', function(code, signal) {
    if (shuttingDown) return;
    const reason = signal ? 'signal ' + signal : 'code ' + code;
    console.warn('[dev] optional ' + name + ' exited with ' + reason);
  });
}

function shutdown(code) {
  shuttingDown = true;
  children.forEach(function(entry) {
    if (!entry.child.killed) entry.child.kill();
  });
  try {
    fs.rmSync(path.join(root, 'codex-dev.pid'), { force: true });
  } catch {}
  setTimeout(function() {
    process.exit(code);
  }, 250).unref();
}

process.on('SIGINT', function() { shutdown(0); });
process.on('SIGTERM', function() { shutdown(0); });

run('api', process.execPath, ['server/index.cjs']);
run('vite', viteBin, []);
if (process.env.CONTENT_BOARD_PROXY !== '0') {
  runOptional('content-board-proxy', process.execPath, [contentBoardProxyBin]);
}
